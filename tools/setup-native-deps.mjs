import {mkdirSync,existsSync,writeFileSync,readFileSync,mkdtempSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root} from './game-image.mjs';

const packages=[
  {name:'zydis',repository:'zyantific/zydis',commit:'a2278f1d254e492f6a6b39f6cb5d1f5d515659dc'},
  {name:'zycore',repository:'zyantific/zycore-c',commit:'0b2432ced0884fd152b471d97ecf0258ff4d859f'},
  {name:'tomlplusplus',repository:'marzer/tomlplusplus',commit:'30172438cee64926dc41fdd9c11fb3ba5b2ba9de'},
  {name:'imgui',repository:'ocornut/imgui',commit:'8199457a7d9e453f8d3d9cadc14683fb54a858b5'},
  {name:'sdl3',repository:'libsdl-org/SDL',commit:'fa2c02bb6e21974a89ea9824bc53c9932abe5f9c'},
];
try{
  const directory=join(root,'local/native-deps');mkdirSync(directory,{recursive:true});
  for(const pkg of packages){
    const target=join(directory,pkg.name);if(existsSync(target)){
      const record=JSON.parse(readFileSync(join(target,'.heroes-source.json')));
      if(record.commit!==pkg.commit||record.repository!==pkg.repository)throw new Error(`Existing ${pkg.name} source differs from the pinned dependency; move it aside before updating.`);
      console.log(`${pkg.name} already installed at the pinned revision`);continue;
    }
    const url=`https://codeload.github.com/${pkg.repository}/tar.gz/${pkg.commit}`;
    console.log(`Fetching ${pkg.name} at ${pkg.commit}`);
    const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer()),stage=mkdtempSync(join(directory,'.fetch-'));
    try{
      const archive=join(stage,'source.tgz');writeFileSync(archive,bytes);
      const source=join(stage,'source');mkdirSync(source);
      // Zydis' Meson subprojects alias is a POSIX symlink. The tools use the
      // separately pinned Zycore checkout and do not need that alias on Windows.
      const result=spawnSync('tar',['-xzf',archive,'-C',source,'--strip-components=1','--exclude=*/subprojects'],{encoding:'utf8'});
      if(result.error||result.status!==0)throw new Error(result.error?.message??result.stderr);
      writeFileSync(join(source,'.heroes-source.json'),JSON.stringify({...pkg,url,archiveSha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n');
      renameSync(source,target);
    }finally{rmSync(stage,{recursive:true,force:true});}
  }
}catch(error){console.error(error.message);process.exitCode=1;}
