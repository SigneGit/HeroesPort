import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,existsSync,readFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {importAssets,validateAssets,manifestName} from '../tools/portable-assets.mjs';
import {preparePortable} from '../tools/portable-prepare.mjs';

function syntheticGame() {
  const xbe=Buffer.alloc(0x500),set=(at,value)=>xbe.writeUInt32LE(value>>>0,at);
  xbe.write('XBEH');set(0x104,0x10000);set(0x108,0x400);set(0x10c,0x2000);set(0x118,0x10180);set(0x11c,1);set(0x120,0x10240);
  set(0x128,0x11000^0xa8fc57ab);set(0x158,0x11040^0x5b6d40b6);set(0x188,0x12345678);
  set(0x240,4);set(0x244,0x11000);set(0x248,0x100);set(0x24c,0x400);set(0x250,0x80);set(0x254,0x10280);xbe.write('.text\0',0x280);xbe[0x400]=0xc3;
  const iso=Buffer.alloc(0x13000);iso.write('MICROSOFT*XBOX*MEDIA',0x10000);iso.write('MICROSOFT*XBOX*MEDIA',0x107ec);iso.writeUInt32LE(0x22,0x10014);iso.writeUInt32LE(64,0x10018);iso.writeUInt32LE(0x24,0x11004);iso.writeUInt32LE(xbe.length,0x11008);iso[0x1100c]=0x20;iso[0x1100d]=11;iso.write('default.xbe',0x1100e);xbe.copy(iso,0x12000);
  return {iso,profile:{name:'Synthetic',titleId:'0x12345678',xbeSha256:createHash('sha256').update(xbe).digest('hex')}};
}
test('portable extraction is atomic, reusable and relative to its release folder',()=>{
  const d=mkdtempSync(join(tmpdir(),'heroes-portable-import-'));
  try {
    const {iso,profile}=syntheticGame(),image=join(d,'game.iso'),assets=join(d,'release/assets');writeFileSync(image,iso);
    assert.equal(importAssets(image,assets,profile),1);
    assert.ok(existsSync(join(assets,manifestName)));
    assert.ok(!existsSync(join(d,'local')));
    renameSync(join(d,'release'),join(d,'moved release'));
    const moved=join(d,'moved release/assets');assert.equal(validateAssets(moved,profile),1);
    assert.equal(importAssets(image,moved,profile),1);
    assert.throws(()=>importAssets(image,join(d,'unsupported/assets'),{...profile,xbeSha256:'0'.repeat(64)}),/Unsupported ISO/);
    assert.ok(!existsSync(join(d,'unsupported/assets')));
    writeFileSync(join(moved,'default.xbe'),'damaged');assert.throws(()=>validateAssets(moved,profile),/missing or damaged/);
  } finally {rmSync(d,{recursive:true,force:true});}
});
test('folder setup verifies the complete inventory before installing or reusing it',()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-extracted-'));
  try {
    const {iso,profile}=syntheticGame();
    const source=join(directory,'my extracted copy'),target=join(directory,'assets');
    mkdirSync(source);
    const xbe=iso.subarray(0x12000,0x12500);
    writeFileSync(join(source,'default.xbe'),xbe);
    const inventory=[['default.xbe',xbe.length,profile.xbeSha256]];
    profile.extractedTreeSha256=createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
    assert.equal(importAssets(source,target,profile),1);
    assert.equal(validateAssets(target,profile),1);
    writeFileSync(join(source,'extra.txt'),'not part of the disc');
    assert.throws(()=>importAssets(source,target,profile),/complete, unmodified/);
    assert.equal(validateAssets(target,profile),1);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('portable preparation runs only bundled tools and clears readiness on failure',async()=>{
  const d=mkdtempSync(join(tmpdir(),'heroes-portable-build-'));
  try {
    const {iso,profile}=syntheticGame(),image=join(d,'game.iso'),release=join(d,'release');writeFileSync(image,iso);
    const put=(name,data='test')=>{const file=join(release,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,data);};
    for(const name of ['Heroes.exe','compiler/clang.exe','compiler/lld-link.exe','compiler/xbe_recomp.exe','compiler/Heroes.lib'])put(name);
    put('config/supported-build.json',JSON.stringify(profile));
    const steps=[];
    await preparePortable({directory:release,iso:image,run:async(executable,args,cwd)=>{
      steps.push(executable);assert.ok(executable.startsWith(join(release,'compiler')));
      assert.ok(!existsSync(join(release,'heroes-ready.json')));
      if(executable.endsWith('clang.exe'))writeFileSync(join(cwd,args.at(-1)),'object');
      if(executable.endsWith('lld-link.exe'))put('Heroes.dll');
    }});
    assert.equal(steps.length,67);assert.equal(JSON.parse(readFileSync(join(release,'heroes-ready.json'))).schemaVersion,2);
    await assert.rejects(preparePortable({directory:release,run:async()=>{throw Error('compiler failed');}}),/compiler failed/);
    assert.ok(!existsSync(join(release,'heroes-ready.json')));assert.equal(validateAssets(join(release,'assets'),profile),1);
    const manifest=JSON.parse(readFileSync(join(release,'assets',manifestName)));manifest.files[0].path='../escape';put('assets/'+manifestName,JSON.stringify(manifest));
    assert.throws(()=>validateAssets(join(release,'assets'),profile),/Unsafe path/);
  } finally {rmSync(d,{recursive:true,force:true});}
});
