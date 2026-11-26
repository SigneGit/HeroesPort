import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../tools/game-image.mjs';
const compiler=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';

test('fixed and programmable vertex shaders use current diffuse only when its array is absent',{skip:!existsSync(compiler)},()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-diffuse-test-'));
  try{
    const executable=join(directory,'diffuse.exe');
    const build=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'third_party/xboxdecomp/runtime'),join(root,'tests/native/current_diffuse.cpp'),join(root,'third_party/xboxdecomp/runtime/gpu/shaders.cpp'),'-o',executable],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync(executable,[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
