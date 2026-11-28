import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../tools/game-image.mjs';
const compiler=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';

test('mana refill skips disabled cheats, dead heroes, invalid values and temporary over-max mana',{skip:!existsSync(compiler)},()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-cheats-'));
  try {
    const executable=join(directory,'cheats.exe');
    const build=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'native/src'),join(root,'tests/native/cheat_policy.cpp'),'-o',executable],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync(executable,[],{encoding:'utf8'});
    assert.equal(run.status,0,run.stdout+run.stderr);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('actual cheat hooks restore borrowed stats before saves/copies and restrict combat cheats to the intended actors',{skip:!existsSync(compiler)},()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-cheat-hooks-'));
  try {
    const executable=join(directory,'hooks.exe');
    const build=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'native/src'),'-I',join(root,'third_party/xboxdecomp/runtime'),join(root,'tests/native/cheats_runtime.cpp'),'-o',executable],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});
    assert.equal(build.status,0,build.stdout+build.stderr);
    for(const args of [[],['pal']]) {
      const run=spawnSync(executable,args,{encoding:'utf8'});
      assert.equal(run.status,0,run.stdout+run.stderr);
    }
  } finally {rmSync(directory,{recursive:true,force:true});}
});
