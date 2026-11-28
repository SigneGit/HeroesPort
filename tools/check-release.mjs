import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashFile} from './portable-assets.mjs';

export function checkRelease(directory) {
  directory=resolve(directory);
  const manifest=JSON.parse(readFileSync(join(directory,'release-files.json'),'utf8'));
  const expected=new Map(manifest.files.map(f=>[f.path,f.sha256]));
  if(!expected.has('recomplauncher.json'))throw Error('Incomplete release: recomplauncher.json');
  for(const required of ['HeroesLauncher.exe','Heroes.exe','runtime/node.exe','tools/portable-prepare.mjs','tools/portable-assets.mjs','tools/supported-builds.mjs','config/supported-build.json','compiler/clang.exe','compiler/lld-link.exe','compiler/xbe_recomp.exe','compiler/Heroes.lib','compiler/config/heroes.toml','licenses/Node-LICENSE.txt'])
    if(!expected.has(required))throw Error(`Incomplete release: ${required}`);
  const profile=JSON.parse(readFileSync(join(directory,'config/supported-build.json'),'utf8'));
  for(const build of [profile,...profile.variants??[]]) {
    if(build.nativeConfig&&!expected.has('compiler/config/'+build.nativeConfig))
      throw Error('Incomplete regional compiler configuration: '+build.nativeConfig);
  }
  const found=new Set();
  function walk(path) {
    for(const entry of readdirSync(path,{withFileTypes:true})) {
      const file=join(path,entry.name),name=relative(directory,file).replaceAll('\\','/');
      if(lstatSync(file).isSymbolicLink())throw Error(`Linked content in release: ${name}`);
      if(entry.isDirectory()) {
        if(name==='assets'||name==='compiler/work'||name==='hdd'||name==='local'||name==='native')throw Error(`Private game/output directory in release: ${name}`);
        walk(file);continue;
      }
      if(name==='release-files.json')continue;
      if(/\.(iso|xbe|bik|xmv|xpr|bin|obj|o|cpp|pdb)$/i.test(name)||/heroes\.dll$/i.test(name))throw Error(`Game or build output in release: ${name}`);
      if(!expected.has(name)||hashFile(file)!==expected.get(name))throw Error(`Unexpected or changed release file: ${name}`);
      found.add(name);
    }
  }
  walk(directory);
  for(const name of expected.keys())if(!found.has(name))throw Error(`Missing release file: ${name}`);
  return found.size;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(`Portable release passed: ${checkRelease(process.argv[2]??'release')} files, no imported assets or generated gameplay code.`);}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
