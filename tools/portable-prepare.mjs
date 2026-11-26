import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,openSync,closeSync,renameSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {availableParallelism,freemem} from 'node:os';
import {importAssets,validateAssets,hashFile} from './portable-assets.mjs';

const releaseRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function preparePortable({directory=releaseRoot,iso,run=runTool,progress=()=>{}}={}) {
  const ready=join(directory,'heroes-ready.json');rmSync(ready,{force:true});
  const profile=JSON.parse(readFileSync(join(directory,'config/supported-build.json'),'utf8'));
  const assets=join(directory,'assets'),compiler=join(directory,'compiler'),work=join(compiler,'work/Heroes');
  for(const file of ['Heroes.exe','compiler/clang.exe','compiler/lld-link.exe','compiler/xbe_recomp.exe','compiler/Heroes.lib'])
    if(!existsSync(join(directory,file)))throw Error(`Missing release file: ${file}. Extract the complete release again.`);
  console.log('Verifying and extracting your game into this release folder...');
  progress(0,'Verifying game files');
  const count=iso?importAssets(iso,assets,profile):validateAssets(assets,profile);
  console.log(`Verified ${count} game files. Preparing the game locally; no downloads or installed build tools are needed.`);
  mkdirSync(work,{recursive:true});mkdirSync(join(directory,'logs'),{recursive:true});
  const log=join(directory,'logs/prepare.log');writeFileSync(log,'');
  progress(0.15,'Translating the Xbox executable');
  await run(join(compiler,'xbe_recomp.exe'),[join(compiler,'config/heroes.toml'),join(assets,'default.xbe'),work,'--xdk',join(compiler,'xdk')],work,log);
  const units=['x86_func_mapping',...Array.from({length:64},(_,i)=>`x86_recomp.${i}`)];
  let next=0,finished=0,failure;
  const slots=Math.max(1,Math.min(4,availableParallelism(),Math.floor(freemem()/(512*1024*1024))));
  await Promise.all(Array.from({length:slots},async()=>{
    while(!failure&&next<units.length) {
      const unit=units[next++];
      try {
        await run(join(compiler,'clang.exe'),['-target','x86_64-pc-windows-msvc','-fms-compatibility-version=19.40','-std=c++20','-O2','-march=x86-64-v2','-fno-strict-aliasing','-DNDEBUG','-DX86_GAME_CODE','-nostdinc','-nostdinc++','-w','-isystem',join(compiler,'include/freestanding'),'-I',join(compiler,'include'),'-c',unit+'.cpp','-o',unit+'.obj.tmp'],work,log);
        renameSync(join(work,unit+'.obj.tmp'),join(work,unit+'.obj'));
        console.log(`Preparing game code: ${++finished}/${units.length}`);
        progress(0.2+0.75*finished/units.length,`Compiling game code (${finished}/${units.length})`);
      } catch(error) {failure=error;}
    }
  }));
  if(failure)throw failure;
  console.log('Linking the game...');
  progress(0.96,'Linking the game');
  await run(join(compiler,'lld-link.exe'),['/dll','/noentry','/nodefaultlib','/machine:x64','/opt:noicf','/def:exports.def','/implib:code.lib',`/out:${join(directory,'Heroes.dll')}`,join(compiler,'Heroes.lib'),...units.map(u=>u+'.obj')],work,log);
  // The SDK accepts a matching un-stamped DLL newer than its host. Remove any
  // old SDK stamp so copying/moving this portable folder cannot retain one.
  rmSync(join(work,'built.txt'),{force:true});
  if(!existsSync(join(directory,'Heroes.dll')))throw Error('The compiler did not produce Heroes.dll.');
  writeFileSync(ready,JSON.stringify({schemaVersion:2,importedFiles:count,xbeSha256:profile.xbeSha256,hostSha256:hashFile(join(directory,'Heroes.exe')),codeSha256:hashFile(join(directory,'Heroes.dll'))})+'\n');
  console.log('Ready to play. Assets, generated code, logs, settings and saves stay inside this release folder.');
  progress(1,'Ready to play');
}
function runTool(executable,args,cwd,log) {
  return new Promise((resolve,reject)=>{
    const fd=openSync(log,'a');let child;
    try {child=spawn(executable,args,{cwd,stdio:['ignore',fd,fd],windowsHide:true});}
    finally {closeSync(fd);}
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve():reject(Error(`${executable.split(/[\\/]/).pop()} failed (${code}). See logs/prepare.log.\n${readFileSync(log,'utf8').slice(-2000)}`)));
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [argument,...extra]=process.argv.slice(2);
    if(argument==='--prepare') {
      if(extra.length>1||(extra.length&&(!extra[0].startsWith('--game=')||extra[0].length===7)))
        throw Error('Use --prepare with --game=<ISO or extracted folder>, or omit --game to rebuild an existing import.');
      await preparePortable({iso:extra[0]?.slice(7),progress:(fraction,label)=>console.log(`progress ${fraction.toFixed(3)} ${label}`)});
    } else {
      if(!argument||extra.length)throw Error('Select your ISO or use --existing.');
      await preparePortable({iso:argument==='--existing'?undefined:argument});
    }
  } catch(error) {console.error(`Game preparation failed: ${error.message}`);process.exitCode=1;}
}
