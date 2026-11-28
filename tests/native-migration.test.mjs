import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root} from '../tools/game-image.mjs';
import {flatTables,evidenceTables} from '../tools/prepare-native.mjs';

test('SDK snapshot retains upstream license and immutable file provenance except documented patches',()=>{
  const provenance=JSON.parse(readFileSync(join(root,'third_party/xboxdecomp.provenance.json')));
  const local=JSON.parse(readFileSync(join(root,'third_party/xboxdecomp.local-changes.json'))),changes=local.changes;
  const digest=createHash('sha256').update(JSON.stringify(provenance.files)).digest('hex');assert.equal(digest,provenance.snapshotSha256);
  for(const file of provenance.files){
    const bytes=readFileSync(join(root,'third_party/xboxdecomp',file.path));
    const change=changes.find(entry=>entry.path===file.path);
    if(change){
      assert.equal(change.baseSha256,file.sha256);
      assert.equal(createHash('sha256').update(readFileSync(join(root,'third_party',change.patch))).digest('hex'),change.patchSha256);
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'),change?.patchedSha256??file.sha256,file.path);
  }
  for(const file of local.additions??[]){
    assert.equal(createHash('sha256').update(readFileSync(join(root,'third_party/xboxdecomp',file.path))).digest('hex'),file.sha256,file.path);
    assert.equal(createHash('sha256').update(readFileSync(join(root,'third_party',file.patch))).digest('hex'),file.patchSha256);
    assert.ok(!provenance.files.some(original=>original.path===file.path));
  }
  assert.match(readFileSync(join(root,'third_party/xboxdecomp/LICENSE'),'utf8'),/MIT License/);
});
test('profile readers only accept explicit numeric addresses and method tags',()=>{
  const flat=flatTables('[symbols]\nGood = 0x1234\nMissing = 0\nBad = "0x2345"\n[data]\nPointer = 123\n');
  assert.deepEqual(flat,{symbols:{Good:0x1234,Missing:0},data:{Pointer:123}});
  const evidence=evidenceTables('[symbols]\nGood = { address = 0x1234, method = "masked-bytes" }\n');
  assert.deepEqual(evidence.symbols.Good,{address:0x1234,method:'masked-bytes'});
});
test('5455 layout matches individually reviewed Heroes facts and fits its device object',()=>{
  const tables=flatTables(readFileSync(join(root,'native/config/heroes-5455-layout.toml'),'utf8'));
  const review=JSON.parse(readFileSync(join(root,'native/config/verified.json')));
  assert.deepEqual(tables.layout,Object.fromEntries(Object.entries(review.layout).map(([name,fact])=>[name,fact.value])));
  assert.equal(tables.layout.CDevice_Size,0x2080);
  for(const [name,fact]of Object.entries(review.layout)){
    assert.ok(fact.evidence.includes('0x'),name);
    if(name.startsWith('CDevice_')&&name!=='CDevice_Size')assert.ok(fact.value+4<=tables.layout.CDevice_Size,name);
  }
  assert.equal(tables.layout.Stream_Buffer+4,tables.layout.Stream_Size);
  assert.equal(tables.layout.CDevice_Viewport+24<=tables.layout.CDevice_Size,true);
});
test('reviewed controller metadata is tied to the exact user executable',()=>{
  const profile=JSON.parse(readFileSync(join(root,'config/supported-build.json'))),review=JSON.parse(readFileSync(join(root,'native/config/verified.json')));
  assert.equal(review.xbeSha256,profile.xbeSha256);assert.equal(review.data.XPP_GamepadType.address,0x2907b4);
  assert.ok(review.data.XPP_GamepadType.evidence.includes('0x291A19'));
});
test('the native build excludes the archived JS runtime and uses the SDK',()=>{
  const cmake=readFileSync(join(root,'native/CMakeLists.txt'),'utf8');
  assert.match(cmake,/third_party\/xboxdecomp\/cmake\/XbeRecomp.cmake/);assert.match(cmake,/add_xbe_image\(Heroes/);
  assert.ok(!cmake.includes('js-prototype'));assert.ok(existsSync(join(root,'research/js-prototype/runtime/cpu.mjs')));
});
const localRecompiler=join(root,'local/native-tools/xbe_recomp.exe');
const recompiler=existsSync(localRecompiler)?localRecompiler:join(root,'native/out/build/release/compiler/xbe_recomp.exe');
test('compiled SDK recompiler emits native C++ for a synthetic XBE and rejects a wrong title', {skip:!existsSync(recompiler)},()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-native-test-'));
  try{
    const image=Buffer.alloc(0x500),set=(at,value)=>image.writeUInt32LE(value>>>0,at);
    image.write('XBEH');set(0x104,0x10000);set(0x108,0x400);set(0x10c,0x2000);set(0x118,0x10180);set(0x11c,1);set(0x120,0x10240);
    set(0x128,0x11000^0xa8fc57ab);set(0x158,0x11040^0x5b6d40b6);set(0x188,0x12345678);
    set(0x240,4);set(0x244,0x11000);set(0x248,0x100);set(0x24c,0x400);set(0x250,1);set(0x254,0x10280);image.write('.text\0',0x280);image[0x400]=0xc3;
    const xbe=join(directory,'test.xbe'),config=join(directory,'test.toml'),out=join(directory,'generated');writeFileSync(xbe,image);
    const settings='[xbe]\nlibrary = "Synthetic.dll"\npartitions = 2\ncode_sections = [".text"]\ngap_fill = false\npointer_seeds = false\nentry = 0x11000\n';
    writeFileSync(config,settings+'title = 0x12345678\n');
    let run=spawnSync(recompiler,[config,xbe,out],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);
    const units=readdirSync(out).filter(name=>/^x86_recomp\.\d+\.cpp$/.test(name));assert.equal(units.length,2);
    assert.ok(units.some(file=>readFileSync(join(out,file),'utf8').includes('__imp__sub_00011000')));
    // Use the production profiles' binding mode: the shared host must replace
    // this API by name even when the next image moves it to another address.
    for(const region of ['usa','pal']) {
      const production=readFileSync(join(root,`native/config/heroes-${region}.toml`),'utf8');
      const binding=production.match(/^named\s*=\s*(true|false)\s*$/m)?.[0]??'named = false';
      writeFileSync(config,settings+'title = 0x12345678\n'+binding+'\n[symbols]\nXMountUtilityDrive = 0x11000\n');
      const namedOut=join(directory,region);
      run=spawnSync(recompiler,[config,xbe,namedOut],{encoding:'utf8'});
      assert.equal(run.status,0,run.stdout+run.stderr);
      assert.match(readFileSync(join(namedOut,'image_symbols.h'),'utf8'),/#define IMAGE_NAMED 1/);
      assert.match(readFileSync(join(namedOut,'imports.def'),'utf8'),/__imp__sub_XMountUtilityDrive/);
      assert.match(readFileSync(join(namedOut,'exports.def'),'utf8'),/X86Symbols DATA/);
    }
    writeFileSync(config,settings+'title = 0xabcdef01\n');run=spawnSync(recompiler,[config,xbe,join(directory,'wrong')],{encoding:'utf8'});
    assert.notEqual(run.status,0);assert.ok(!existsSync(join(directory,'wrong')));
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('active mapping rejects heuristic guesses and promotes reviewed graphics entries', {skip:!existsSync(join(root,'native/config/heroes.toml'))},()=>{
  const profile=flatTables(readFileSync(join(root,'native/config/heroes.toml'),'utf8'));
  assert.equal(profile.symbols.XInitDevices,0x290c73);assert.equal(profile.data.XPP_GamepadType,0x2907b4);
  assert.equal(profile.symbols.BinkDoFrame,0);assert.equal(profile.symbols.Direct3D_CreateDevice,0x24e8e0);
  const review=JSON.parse(readFileSync(join(root,'native/config/verified.json')));
  for(const type of ['symbols','data'])for(const [name,fact]of Object.entries(review[type]))assert.equal(profile[type][name],fact.address,name);
  assert.equal(profile.symbols.XMountUtilityDrive,0x58957);
  assert.equal(profile.symbols.XInputGetCapabilities,0x291774);
});
