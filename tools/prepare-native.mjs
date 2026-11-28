import {readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {root,loadGame} from './game-image.mjs';
import {hex} from './xbe.mjs';

function writeIfChanged(path,source){
  if(!existsSync(path)||readFileSync(path,'utf8')!==source)writeFileSync(path,source);
}

export function flatTables(source){
  const result={};let section='';
  for(const line of source.split(/\r?\n/)){
    const heading=line.match(/^\[([\w]+)\]\s*$/);if(heading){section=heading[1];result[section]??={};continue;}
    const field=line.match(/^([A-Za-z_][\w]*)\s*=\s*(0x[\da-fA-F]+|\d+)\s*(?:#.*)?$/);
    if(field&&section)(result[section]??={})[field[1]]=Number(field[2]);
  }
  return result;
}
export function evidenceTables(source){
  const result={};let section='';
  for(const line of source.split(/\r?\n/)){
    const heading=line.match(/^\[(symbols|data)\]$/);if(heading){section=heading[1];result[section]={};continue;}
    const field=line.match(/^(\w+) = \{ address = (0x[\da-fA-F]+), method = "([\w-]+)" \}$/);
    if(field&&section)result[section][field[1]]={address:Number(field[2]),method:field[3]};
  }
  return result;
}

export function prepareNative(){
  const {layout,profile}=loadGame();
  const native=join(root,'native'),analysis=join(root,'local/native-analysis'),tool=join(root,'local/native-tools/xbe_symbols.exe'),sdk=join(root,'third_party/xboxdecomp');
  if(!existsSync(tool))throw new Error('Build native tools first: node tools/build-native-tools.mjs');
  const assets=join(native,'assets'),source=join(root,'local/game/assets');
  if(!existsSync(assets))symlinkSync(source,assets,process.platform==='win32'?'junction':'dir');
  if(realpathSync(assets)!==realpathSync(source))throw new Error('native/assets must point to the verified import');
  mkdirSync(analysis,{recursive:true});
  const scans=[];
  for(const build of [5849,4831]){
    const out=join(analysis,`candidate-${build}.toml`),proof=join(analysis,`evidence-${build}.toml`);
    const run=spawnSync(tool,[join(source,'default.xbe'),join(sdk,'xdk'),'--signature-build',String(build),'--library','Heroes.dll','--name','heroes','--out',out,'--evidence',proof],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
    writeFileSync(join(analysis,`scan-${build}.log`),run.stdout+run.stderr);
    if(run.error||run.status!==0)throw new Error(run.error?.message??run.stderr);
    scans.push({build,tables:flatTables(readFileSync(out,'utf8')),evidence:evidenceTables(readFileSync(proof,'utf8')),source:readFileSync(out,'utf8')});
  }
  const names={symbols:new Set(),data:new Set()},selected={symbols:{},data:{}},review={fingerprint:layout.sha256,actualXdk:5455,symbols:{},data:{},rejected:[]};
  for(const scan of scans)for(const type of ['symbols','data'])for(const name of Object.keys(scan.tables[type]??{}))names[type].add(name);
  // Generic mixer extension maintained in our documented SDK patch. The
  // supplied signature catalogs do not yet name this API; its address must
  // come from the fingerprint-bound manual review below.
  names.symbols.add('IDirectSoundBuffer_SetNotificationPositions');
  for(const type of ['symbols','data'])for(const name of [...names[type]].sort()){
    const proposals=[];
    for(const scan of scans){
      const value=scan.tables[type]?.[name]??0,proof=scan.evidence[type]?.[name];
      if(value&&proof&&(type==='symbols'?proof.method==='masked-bytes':proof.method==='reference-or-export'))proposals.push({address:value,referenceBuild:scan.build,method:proof.method});
    }
    const unique=[...new Set(proposals.map(p=>p.address))];
    selected[type][name]=unique.length===1?unique[0]:0;
    review[type][name]={address:selected[type][name],evidence:proposals};
    if(unique.length>1)review.rejected.push({type,name,reason:'cross-build references disagree',proposals});
  }
  // An exact .XTLID identity is accepted separately from heuristic scanner matches.
  const xbe=readFileSync(join(source,'default.xbe')),xtlid=layout.sections.find(s=>s.name==='.XTLID'),exports=new Map();
  if(xtlid)for(let at=xtlid.fileOffset;at+8<=xtlid.fileOffset+xtlid.fileSize;at+=8){const id=xbe.readUInt32LE(at),va=xbe.readUInt32LE(at+4);if(id)exports.set(id,va);}
  for(const scan of scans){
    let section='';
    for(const line of readFileSync(join(sdk,`xdk/${scan.build}/signatures.toml`),'utf8').split(/\r?\n/)){
      const heading=line.match(/^\[(symbols|data|anchors)\]$/);if(heading){section=heading[1];continue;}
      const field=line.match(/^(\w+)\s*=.*\bxtlid\s*=\s*(0x[\da-fA-F]+)/);
      if(!field||!['symbols','data'].includes(section))continue;
      const id=Number(field[2]),address=exports.get(id);if(!address)continue;
      selected[section][field[1]]=address;review[section][field[1]]={address,evidence:[{method:'XTLID',id,referenceBuild:scan.build}]};
    }
  }
  const verified=JSON.parse(readFileSync(join(native,'config',profile.verifiedMapping??'verified.json')));
  if(verified.xbeSha256!==layout.sha256&&!verified.xbeSha256s?.includes(layout.sha256))throw new Error('Reviewed mapping fingerprint mismatch');
  for(const type of ['symbols','data'])for(const [name,fact]of Object.entries(verified[type]??{})){
    if(!names[type].has(name))throw new Error(`Unknown reviewed ${type} name: ${name}`);
    if(!Number.isSafeInteger(fact.address)||!fact.evidence?.trim())throw new Error(`Invalid reviewed fact: ${name}`);
    if(!layout.sections.some(s=>(type!=='symbols'||s.executable)&&fact.address>=s.address&&fact.address+(type==='data'?4:1)<=s.address+s.virtualSize))throw new Error(`Reviewed ${type} address outside image: ${name}`);
    selected[type][name]=fact.address;review[type][name]={address:fact.address,evidence:[{method:'manual',detail:fact.evidence}]};
  }
  const groups=new Map();for(const [name,address]of Object.entries(selected.symbols))if(address){if(!groups.has(address))groups.set(address,[]);groups.get(address).push(name);}
  for(const [address,aliases]of groups)if(aliases.length>1){for(const name of aliases)selected.symbols[name]=0;review.rejected.push({reason:'conflicting named functions at one address',address,aliases});}
  const sections=JSON.parse(scans[0].source.match(/^code_sections\s*=\s*(\[.*\])$/m)[1]);
  const layoutLines=['# Generated from verified.json; facts apply only to the fingerprinted Heroes XBE.','[layout]'];
  for(const [name,fact]of Object.entries(verified.layout??{})){
    if(!/^\w+$/.test(name)||!Number.isSafeInteger(fact.value)||fact.value<0||!fact.evidence?.trim())throw new Error(`Invalid reviewed layout: ${name}`);
    layoutLines.push(`# ${fact.evidence.replace(/[\r\n]/g,' ')}`,`${name} = ${hex(fact.value)}`);
  }
  if(!verified.layout)throw new Error('Reviewed layout facts are required');
  writeIfChanged(join(native,'config/heroes-5455-layout.toml'),layoutLines.join('\n')+'\n');
  const lines=['# Generated by prepare-native.mjs. Only conservative matches are enabled.','# Remaining zero symbols trap; this profile is not gameplay-ready.',`includes = ["heroes-5455-layout.toml", "${profile.hooks??'heroes-hooks.toml'}"]`,'', '[xbe]', 'named = true', 'path = "assets/default.xbe"',`title = ${layout.titleId}`,`entry = ${hex(layout.entryPoint)}`,'library = "Heroes.dll"','out = "generated/heroes"','partitions = 64','code_sections = '+JSON.stringify(sections),'','[functions]',...profile.analysisSeeds.map(at=>`${at} = ""`),''];
  for(const type of ['symbols','data']){lines.push(`[${type}]`);for(const name of Object.keys(selected[type]).sort())lines.push(`${name} = ${hex(selected[type][name])}`);lines.push('');}
  writeIfChanged(join(native,'config/heroes.toml'),lines.join('\n'));
  writeIfChanged(join(native,'config',profile.nativeConfig??'heroes-usa.toml'),lines.join('\n'));
  writeFileSync(join(analysis,'profile-review.json'),JSON.stringify(review,null,2)+'\n');
  const summary={fingerprint:layout.sha256,matchedFunctions:Object.values(selected.symbols).filter(Boolean).length,totalFunctions:Object.keys(selected.symbols).length,matchedData:Object.values(selected.data).filter(Boolean).length,totalData:Object.keys(selected.data).length,reviewedLayouts:Object.keys(verified.layout).length,rejected:review.rejected.length,unknownLayouts:'Additional graphics fields and DirectSound layouts remain unverified'};
  writeFileSync(join(analysis,'profile-summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{prepareNative();}catch(error){console.error(error.message);process.exitCode=1;}
}
