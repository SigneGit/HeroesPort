import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,mkdtempSync,renameSync,rmSync,lstatSync} from 'node:fs';
import {join,dirname,resolve,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {root} from './game-image.mjs';
import {hashFile} from './portable-assets.mjs';
import {checkRelease} from './check-release.mjs';

try {
  const args=process.argv.slice(2),zip=args.includes('--zip');
  const paths=args.filter(arg=>arg!=='--zip');
  if(paths.length>1)throw Error('Usage: node tools/package-release.mjs [destination] [--zip]');
  const destination=resolve(paths[0]??join(root,'release'));
  const packageVersion=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
  const archive=join(dirname(destination),`Heroes-PC-v${packageVersion}-Windows-x64.zip`);
  if(zip&&existsSync(archive))throw Error(`Release archive already exists: ${archive}`);
  if(existsSync(destination))throw Error('Release destination already exists. Choose a new output folder to preserve assets, settings and saves.');
  const build=join(root,'native/out/build/release'),deps=join(root,'local/native-deps');
  for(const name of ['Heroes.exe','HeroesLauncher.exe','compiler/Heroes.lib','compiler/clang.exe','compiler/lld-link.exe','compiler/xbe_recomp.exe'])
    if(!existsSync(join(build,name)))throw Error(`Build the native game first. Missing ${name}`);
  const vswhere=join(process.env['ProgramFiles(x86)']??'C:/Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
  const installation=execFileSync(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8',windowsHide:true}).trim();
  const redist=join(installation,'VC/Redist/MSVC');
  const version=readdirSync(redist).filter(n=>/^\d+\./.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1);
  const crt=join(redist,version,'x64');
  const crtDirectory=join(crt,readdirSync(crt).find(n=>/^Microsoft\.VC\d+\.CRT$/.test(n))??'missing');
  const licenseCache=join(root,'local/release-deps',`node-${process.versions.node}-LICENSE.txt`);
  if(!existsSync(licenseCache)) {
    console.log(`Fetching the matching Node.js ${process.versions.node} license notices...`);
    const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error(`Node.js license download failed: HTTP ${response.status}`);
    const license=await response.text();if(!license.includes('Node.js')||!license.includes('Permission'))throw Error('Unexpected Node.js license response.');
    mkdirSync(dirname(licenseCache),{recursive:true});writeFileSync(licenseCache,license);
  }
  mkdirSync(dirname(destination),{recursive:true});
  const stage=mkdtempSync(join(dirname(destination),'.heroes-package-'));
  try {
    const copy=(source,name)=>{const target=join(stage,name);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);};
    const tree=(source,name)=>{
      for(const entry of readdirSync(source,{withFileTypes:true})) {
        const file=join(source,entry.name),target=join(name,entry.name);
        if(lstatSync(file).isSymbolicLink())throw Error(`Cannot package linked content: ${file}`);
        if(entry.isDirectory())tree(file,target);else copy(file,target);
      }
    };
    for(const name of ['Heroes.exe','HeroesLauncher.exe','compiler/clang.exe','compiler/lld-link.exe','compiler/xbe_recomp.exe','compiler/Heroes.lib','compiler/LLVM-LICENSE.txt'])copy(join(build,name),name);
    for(const name of ['compiler/config','compiler/include','compiler/xdk'])tree(join(build,name),name);
    copy(process.execPath,'runtime/node.exe');
    for(const name of ['portable-prepare.mjs','portable-assets.mjs','supported-builds.mjs','xdvdfs.mjs','xbe.mjs'])copy(join(root,'tools',name),`tools/${name}`);
    copy(join(root,'config/supported-build.json'),'config/supported-build.json');
    for(const name of ['msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll']) {
      copy(join(crtDirectory,name),name);copy(join(crtDirectory,name),`compiler/${name}`);
    }
    for(const [source,name]of [[licenseCache,'Node-LICENSE.txt'],[join(root,'third_party/xboxdecomp/LICENSE'),'XboxDecomp-LICENSE.txt'],[join(root,'third_party/xboxdecomp/THIRD_PARTY.txt'),'XboxDecomp-THIRD-PARTY.txt'],[join(build,'compiler/LLVM-LICENSE.txt'),'LLVM-LICENSE.txt'],[join(deps,'sdl3/LICENSE.txt'),'SDL-LICENSE.txt'],[join(deps,'imgui/LICENSE.txt'),'ImGui-LICENSE.txt'],[join(deps,'tomlplusplus/LICENSE'),'tomlplusplus-LICENSE.txt'],[join(deps,'zydis/LICENSE'),'Zydis-LICENSE.txt'],[join(deps,'zycore/LICENSE'),'Zycore-LICENSE.txt']])copy(source,`licenses/${name}`);
    copy(join(root,'docs/PORTABLE-README.txt'),'README.txt');
    copy(join(root,'recomplauncher.json'),'recomplauncher.json');
    const files=[];
    function inventory(path) {for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())inventory(file);else files.push({path:relative(stage,file).replaceAll('\\','/'),sha256:hashFile(file)});}}
    inventory(stage);
    writeFileSync(join(stage,'release-files.json'),JSON.stringify({schemaVersion:1,nodeVersion:process.versions.node,files},null,2)+'\n');
    checkRelease(stage);
    if(zip) {
      // Stage the ZIP separately so a failed archiver cannot publish a partial file.
      const archiveStage=mkdtempSync(join(dirname(destination),'.heroes-package-'));
      try {
        const temporary=join(archiveStage,'release.zip');
        execFileSync('tar.exe',['-a','-cf',temporary,'-C',stage,...readdirSync(stage)],{windowsHide:true});
        renameSync(temporary,archive);
        console.log(`Release archive created: ${archive}`);
      } finally {rmSync(archiveStage,{recursive:true,force:true});}
    }
    renameSync(stage,destination);
    console.log(`Portable release created: ${destination}\n${files.length} files. No ISO, assets, saves or gameplay DLL included.`);
  } catch(error) {rmSync(stage,{recursive:true,force:true});throw error;}
} catch(error) {console.error(error.message);process.exitCode=1;}
