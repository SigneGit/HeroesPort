import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../tools/game-image.mjs';
const compiler=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';

test('native mixer notifications handle boundaries, wraparound, stops and ADPCM byte markers', {skip:!existsSync(compiler)},()=>{
  const dir=mkdtempSync(join(tmpdir(),'heroes-audio-test-'));
  try{
    const executable=join(dir,'notifications.exe');
    const build=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'third_party/xboxdecomp/runtime'),join(root,'tests/native/buffer_notifications.cpp'),'-o',executable],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync(executable,[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
