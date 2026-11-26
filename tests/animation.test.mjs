import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,loadGame} from '../tools/game-image.mjs';
const compiler=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';

test('animation experiment preserves guest state and counts distinct sampled frames', {skip:!existsSync(compiler)},()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-animation-'));
  try {
    const executable=join(directory,'animation.exe');
    const build=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'native/src'),'-I',join(root,'third_party/xboxdecomp/runtime'),join(root,'tests/native/animation_runtime.cpp'),'-o',executable],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});
    assert.equal(build.status,0,build.stdout+build.stderr);
    for(const mode of ['off','observe','full','invalid']) {
      const run=spawnSync(executable,[mode],{encoding:'utf8',env:{...process.env,HEROES_ANIMATION_TEST:mode}});
      assert.equal(run.status,0,`${mode}: ${run.stdout}${run.stderr}`);
    }
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('animation gate bypass retains native accumulated time and context guards', {skip:process.env.HEROES_TEST_GAME!=='1'}, async()=>{
  const {memory,layout}=loadGame();
  const {decode}=await import('../research/js-prototype/tools/decode.mjs');
  const at=address=>decode(memory.subarray(address-layout.baseAddress),address);
  assert.equal(at(0xb111e).operands[1].displacement,0x49d094);
  assert.equal(at(0xb113d).operands[1].displacement,0xc);
  assert.equal(at(0xb1143).target,0xb1161);
  assert.equal(at(0xb1161).mnemonic,'Test');
  assert.equal(at(0xb1161).operands[0].name,'AL');
  assert.equal(at(0xb116c).operands[0].displacement,0x49c160);
  assert.equal(at(0xb1172).operands[0].displacement,0x110);
  assert.equal(at(0xb1178).operands[0].displacement,0x110);
  assert.equal(at(0xb117e).operands[0].displacement,0x100);
  assert.equal(at(0xb0f65).target,0xb120d);
  assert.equal(at(0x998c7).target,0x99c3c);
  assert.equal(at(0x998d0).operands[0].name,'AL');
  assert.equal(at(0x99c50).operands[1].displacement,0x10);
  assert.equal(at(0x99c79).operands[1].displacement,0x40);
});
