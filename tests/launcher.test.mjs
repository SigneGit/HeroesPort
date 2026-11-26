import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../tools/game-image.mjs';
import {validateLauncherImport} from '../tools/launcher-import.mjs';
import {prepareLauncherGame} from '../tools/launcher-prepare.mjs';

test('preparation completes import and build before marking the game ready',()=>{
  const d=mkdtempSync(join(tmpdir(),'heroes-prepare-'));
  const output=join(d,'native/out/build/release'),steps=[];
  try {
    prepareLauncherGame({projectRoot:d,iso:'my game.iso',validate:()=>480,run:(exe,args)=>{
      steps.push(args);
      assert.ok(!existsSync(join(output,'heroes-ready.json')));
      if(args.includes('-GameOnly')) { mkdirSync(output,{recursive:true});for(const name of ['Heroes.exe','Heroes.dll'])writeFileSync(join(output,name),'test output'); }
    }});
    assert.match(steps[0][0],/launcher-import/);
    assert.match(steps[1][0],/setup-native-deps/);
    assert.match(steps[2][0],/build-native-tools/);
    assert.ok(steps[3].includes('-GameOnly'));
    assert.ok(existsSync(join(output,'heroes-ready.json')));
  } finally {rmSync(d,{recursive:true,force:true});}
});

test('failed preparation clears old readiness and retains imported data',()=>{
  const d=mkdtempSync(join(tmpdir(),'heroes-prepare-failure-'));
  const output=join(d,'native/out/build/release');
  try {
    mkdirSync(output,{recursive:true});writeFileSync(join(output,'heroes-ready.json'),'old success');
    mkdirSync(join(d,'local/game'),{recursive:true});writeFileSync(join(d,'local/game/keep'),'saved import');
    assert.throws(()=>prepareLauncherGame({projectRoot:d,validate:()=>480,run:()=>{throw Error('compiler unavailable');}}),/compiler unavailable/);
    assert.ok(!existsSync(join(output,'heroes-ready.json')));
    assert.ok(existsSync(join(d,'local/game/keep')));
    assert.throws(()=>prepareLauncherGame({projectRoot:d,validate:()=>480,run:()=>{}}),/did not produce Heroes.exe/);
    assert.ok(!existsSync(join(output,'heroes-ready.json')));
  } finally {rmSync(d,{recursive:true,force:true});}
});
test('launcher rejects an imported executable even when its manifest claims compatibility',()=>{
  const d=mkdtempSync(join(tmpdir(),'heroes-launch-import-'));
  try{mkdirSync(join(d,'assets'));writeFileSync(join(d,'assets/default.xbe'),'wrong game');writeFileSync(join(d,'manifest.json'),JSON.stringify({executableSha256:'f48303a89fa9e2043d301ee6444ae69602570a03f1dd3de386f88928b5478ece',files:[]}));assert.throws(()=>validateLauncherImport(d),/does not match/);}finally{rmSync(d,{recursive:true,force:true});}
});
test('launcher recognizes the user verified import',{skip:process.env.HEROES_TEST_GAME!=='1'},()=>assert.equal(validateLauncherImport(),480));
const compiler=process.env.HEROES_CXX??'C:/msys64/mingw64/bin/g++.exe';
test('launcher arguments round-trip spaces, Unicode, quotes and trailing slashes without a shell',{skip:!existsSync(compiler)},()=>{
  const d=mkdtempSync(join(tmpdir(),'heroes-launch-args-'));try{
    const exe=join(d,'args.exe');let run=spawnSync(compiler,['-std=c++20','-O2','-static','-I',join(root,'native/launcher'),join(root,'tests/native/launcher_args.cpp'),'-lshell32','-o',exe],{encoding:'utf8',env:{...process.env,PATH:dirname(compiler)+';'+process.env.PATH}});assert.equal(run.status,0,run.stdout+run.stderr);run=spawnSync(exe,[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);
  }finally{rmSync(d,{recursive:true,force:true});}
});
