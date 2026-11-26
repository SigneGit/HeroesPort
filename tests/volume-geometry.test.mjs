import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../tools/game-image.mjs';
const compiler=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';

test('virtual save-volume geometry survives Heroes byte truncation and respects full host disks',{skip:!existsSync(compiler)},()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-volume-test-'));
  try{
    const executable=join(directory,'volume.exe');
    const build=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'third_party/xboxdecomp/runtime'),join(root,'tests/native/volume_geometry.cpp'),'-o',executable],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync(executable,[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
