import {existsSync,readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root} from './game-image.mjs';

const cxx=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';
const cc=join(dirname(cxx),'gcc.exe'),bin=join(root,'local/native-tools'),deps=join(root,'local/native-deps'),sdk=join(root,'third_party/xboxdecomp');
const environment={...process.env,PATH:dirname(cxx)+';'+process.env.PATH};
async function run(executable,args){
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:root,env:environment,windowsHide:true});let output='';
    child.stdout.on('data',bytes=>output=(output+bytes).slice(-100000));child.stderr.on('data',bytes=>output=(output+bytes).slice(-100000));
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${basename(executable)} failed (${code}):\n${output}`)));
  });
}
function sources(directory,extension){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sources(join(directory,entry.name),extension):entry.name.endsWith(extension)?[join(directory,entry.name)]:[]);}
try{
  if(!existsSync(cxx)||!existsSync(cc))throw new Error('Set HEROES_CXX to an installed MinGW g++.exe for the portable tool build. The Windows runtime uses a separate MSVC/Clang toolchain.');
  const includes=[join(deps,'zydis/include'),join(deps,'zydis/src'),join(deps,'zycore/include'),join(deps,'tomlplusplus/include'),join(sdk,'runtime'),join(sdk,'tools/recomp')];
  for(const include of includes)if(!existsSync(include))throw new Error(`Missing ${include}; run setup-native-deps first`);
  mkdirSync(join(bin,'obj'),{recursive:true});
  const flags=['-O2','-DZYDIS_STATIC_BUILD','-DZYCORE_STATIC_BUILD',...includes.flatMap(directory=>['-I',directory])];
  const cSources=[...sources(join(deps,'zydis/src'),'.c'),...sources(join(deps,'zycore/src'),'.c')];
  const cppSources=[join(sdk,'tools/symbols/main.cpp'),...sources(join(sdk,'tools/recomp'),'.cpp')];
  const headerFingerprint=createHash('sha256');
  for(const directory of [join(deps,'zydis/include'),join(deps,'zycore/include'),join(deps,'tomlplusplus/include'),join(sdk,'tools/recomp'),join(sdk,'runtime/xbe')]){
    for(const file of sources(directory,'.h').concat(sources(directory,'.hpp')).sort())headerFingerprint.update(readFileSync(file));
  }
  const headers=headerFingerprint.digest('hex');
  const tasks=[...cSources,...cppSources].map((source,index)=>{
    const object=join(bin,'obj',`${index}-${basename(source)}.o`),stamp=object+'.sha256';
    const digest=createHash('sha256').update(readFileSync(source)).update(headers).update(JSON.stringify(flags)).update(cxx).digest('hex');
    return {source,object,stamp,digest,compile:!existsSync(object)||!existsSync(stamp)||readFileSync(stamp,'utf8')!==digest};
  });
  const pending=tasks.filter(t=>t.compile);let completed=0;
  console.log(`Compiling ${pending.length} of ${tasks.length} native tool translation units.`);
  await Promise.all(Array.from({length:4},async()=>{
    for(;;){const task=pending.shift();if(!task)break;
      const cpp=task.source.endsWith('.cpp');await run(cpp?cxx:cc,[...flags,cpp?'-std=c++20':'-std=c11','-c',task.source,'-o',task.object]);
      writeFileSync(task.stamp,task.digest);completed++;if(completed%8===0)console.log(`Compiled ${completed} units...`);
    }
  }));
  const libraries=tasks.filter(t=>t.source.endsWith('.c')).map(t=>t.object);
  for(const [name,objects] of [
    ['xbe_symbols',[tasks.find(t=>t.source===cppSources[0]).object]],
    ['xbe_recomp',tasks.filter(t=>t.source.endsWith('.cpp')&&t.source!==cppSources[0]).map(t=>t.object)],
  ]){
    await run(cxx,['-static','-static-libgcc','-static-libstdc++',...objects,...libraries,'-o',join(bin,name+'.exe')]);
    console.log(`Built ${name}.exe`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
