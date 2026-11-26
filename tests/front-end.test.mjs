import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,loadGame} from '../tools/game-image.mjs';
const compiler=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';

test('front-end hooks distinguish submenus and preserve story movies and guest state',{skip:!existsSync(compiler)},()=>{
  const d=mkdtempSync(join(tmpdir(),'heroes-front-end-'));
  try {
    const executable=join(d,'front-end.exe');
    const build=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'native/src'),'-I',join(root,'third_party/xboxdecomp/runtime'),join(root,'tests/native/front_end_runtime.cpp'),'-o',executable],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync(executable,[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);
  } finally {rmSync(d,{recursive:true,force:true});}
});

test('front-end mappings agree with the supported user executable',{skip:process.env.HEROES_TEST_GAME!=='1'},()=>{
  const {memory,layout}=loadGame(),base=layout.baseAddress;
  const u32=at=>memory.readUInt32LE(at-base);
  const target=ret=>memory.readInt32LE(ret-4-base)+ret;
  // Main menu vtable: initialization, hide, update and drawing.
  assert.equal(u32(0x29c764+4),0x3c9f0);
  assert.equal(u32(0x29c764+8),0x106750);
  assert.equal(u32(0x29c764+12),0x3cad0);
  assert.equal(u32(0x29c764+16),0x3d200);
  assert.equal(u32(0x29c764+20),0x3cc40);
  assert.equal(u32(0x3c2fb),0x322388);
  assert.equal(u32(0x3d6c8),0x80); // screen stack count increment
  for(const ret of [0xc49a5,0xc4a01,0xc4a2b,0xc4a55])assert.equal(target(ret),0xc46e0);
  const stringAt=at=>memory.toString('ascii',at-base,memory.indexOf(0,at-base));
  for(const [at,name]of [[0x2a4e84,'legal'],[0x2a4e54,'atari'],[0x2a4e3c,'wotc'],[0x2a4e24,'bink']])
    assert.match(stringAt(at),new RegExp(`Movies\\\\${name}\\.bik$`,'i'));
});
