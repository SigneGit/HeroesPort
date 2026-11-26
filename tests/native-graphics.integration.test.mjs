import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,loadGame} from '../tools/game-image.mjs';

// Optional: requires the user's verified import and the historical iced-x86
// analysis dependency. No game bytes or translated bodies are test fixtures.
const enabled=process.env.HEROES_TEST_GAME==='1';
let memory,base,decode;
async function instruction(at){
  if(!memory){
    const game=loadGame();memory=game.memory;base=game.layout.baseAddress;
    ({decode}=await import('../research/js-prototype/tools/decode.mjs'));
  }
  return decode(memory.subarray(at-base),at);
}
const facts=JSON.parse(readFileSync(join(root,'native/config/verified.json')));

test('finisher selection, action flag and charge meter match the native update and HUD',{skip:!enabled},async()=>{
  assert.equal((await instruction(0xd645c)).operands[1].displacement,0x1b00);
  assert.equal((await instruction(0xd64b5)).operands[1].displacement,0x1afc);
  assert.equal((await instruction(0xd6513)).operands[1].displacement,0x106);
  assert.equal((await instruction(0xd6523)).operands[1].displacement,0x106);
  assert.equal((await instruction(0xd6531)).operands[0].displacement,0x1b08);
  assert.equal((await instruction(0xd6e35)).operands[0].displacement,0x1b08);
  assert.equal((await instruction(0xd754b)).operands[0].displacement,0x1b08);
  assert.equal((await instruction(0x39471)).operands[0].displacement,0x1b08);
  assert.equal((await instruction(0x39481)).operands[1].value,3);
});

test('expanded cheats preserve native save boundaries, quest setters and damage arithmetic',{skip:!enabled},async()=>{
  assert.equal((await instruction(0xd4a54)).operands[1].name,'ECX');
  assert.equal((await instruction(0xd4b06)).operands[1].displacement,0x24ac);
  assert.equal((await instruction(0xd4b0c)).operands[0].displacement,0x2974);
  assert.equal((await instruction(0xd4bba)).operands[1].displacement,0x2620);
  assert.equal((await instruction(0xd4d86)).operands[1].displacement,0x3b8);
  assert.equal((await instruction(0xd4d8c)).operands[1].value,150);
  assert.equal((await instruction(0xc58d3)).operands[1].displacement,0x10);
  assert.equal((await instruction(0x107421)).operands[1].displacement,8);
  const flag=(await instruction(0x10793e)).operands[0];
  assert.equal(flag.base,'EDI');assert.equal(flag.index,'ESI');assert.equal(flag.scale,8);assert.equal(flag.displacement,0xe4);
  assert.equal((await instruction(0xf6e92)).operands[1].displacement,0x10);
  assert.equal((await instruction(0xf6ec6)).operands[0].displacement,0x74);
  assert.equal((await instruction(0xf6ec9)).operands[0].displacement,0x1c);
  assert.equal((await instruction(0xf6ecc)).operands[0].displacement,0x74);
  assert.equal((await instruction(0xd8056)).operands[0].displacement,0x74);
  assert.equal((await instruction(0xcf311)).operands[0].displacement,0x2620);
  assert.equal((await instruction(0xcf372)).operands[0].value,8);
  assert.equal((await instruction(0xb3b94)).operands[0].displacement,0x246f8);
  assert.equal((await instruction(0xd622e)).operands[0].displacement,0x2472);
  assert.equal((await instruction(0xd6237)).operands[1].displacement,0x19b8);
  // Native gem availability reads these five fact bytes: fire, nature, ice,
  // wind and death. The original debug action also sets fact 405.
  for(const [at,offset]of [[0xc7d4c,0x40c],[0xc7d61,0x404],[0xc7d76,0x414],[0xc7d8b,0x1b4],[0xc7da0,0x41c]])
    assert.equal((await instruction(at)).operands[1].displacement,offset);
  assert.equal((await instruction(0x2b6c5)).operands[0].value,405);
  await instruction(0x1bfab0);
  assert.equal(memory.readUInt32LE(0x2a6438+0x198-base),0xdbc70);
  assert.equal((await instruction(0xdbcf4)).target,0xf7f60);
  assert.equal((await instruction(0x1bfab4)).operands[1].displacement,0x1c);
  assert.equal((await instruction(0x1bfbe7)).mnemonic,'Pop');
  assert.equal((await instruction(0x1bfc21)).operands[0].displacement,0x74);
  assert.equal((await instruction(0x1bfc24)).operands[0].base,'EBX');
  assert.equal((await instruction(0x1bfc24)).operands[0].displacement,0x1c);
});

test('cheat hooks match original debug player lookup, resource fields and invulnerability branches',{skip:!enabled},async()=>{
  // The original debug menu labels link their callbacks through vtables.
  await instruction(0x32a00); // initializes the fingerprint-checked image
  const r32=at=>memory.readUInt32LE(at-base);
  const text=at=>memory.subarray(at-base,memory.indexOf(0,at-base)).toString('ascii');
  assert.equal(text((await instruction(0x32a72)).operands[0].value),'Player Unbreakable');
  assert.equal(r32(0x29aff8),0x2c190);
  assert.equal(text((await instruction(0x32bf5)).operands[0].value),'Unlimited Mana');
  assert.equal(r32(0x29b1e8),0x2b5a0);
  assert.equal((await instruction(0x2c192)).target,0xc3770);
  assert.equal((await instruction(0xc3786)).operands[1].displacement,0x49d0b8);
  assert.equal((await instruction(0x2c197)).operands[1].displacement,0x14);
  assert.equal((await instruction(0x2c19a)).target,0xb3b70);
  const table=(await instruction(0xb3b79)).operands[1];
  assert.equal(table.displacement,0x246f8);assert.equal(table.scale,4);
  assert.equal((await instruction(0x2c1aa)).operands[0].displacement,0x1b1c);
  assert.equal((await instruction(0xb90f3)).operands[1].displacement,0x1b1c);
  assert.equal((await instruction(0xb90fd)).operands[0].displacement,0x4c);
  assert.equal((await instruction(0xb90fd)).operands[1].value,0);
  assert.equal((await instruction(0xc55f0)).operands[1].displacement,0x1b1c);
  assert.equal((await instruction(0xc561b)).operands[1].value,1);
  assert.equal((await instruction(0xc561d)).mnemonic,'Ret');
  assert.equal((await instruction(0x2b5c2)).operands[0].displacement,0x24b4);
  assert.equal((await instruction(0x2b5c8)).operands[0].displacement,0x24b0);
  assert.equal((await instruction(0xc5115)).operands[0].displacement,0x74);
  assert.equal((await instruction(0xc5195)).operands[0].displacement,0x24b0);
  assert.equal((await instruction(0xc519b)).operands[0].displacement,0x24b4);
  assert.equal((await instruction(0x69412)).target,facts.symbols.D3DDevice_Swap.address);
});

test('screen-copy hook bypasses unused linear locks and retains original surface releases',{skip:!enabled},async()=>{
  // Verify against the imported executable, not generated code: after both
  // surface acquisitions, before two locks, with an untouched release tail.
  assert.equal((await instruction(0x65056)).target,0x241510);
  assert.equal((await instruction(0x65064)).target,0x242cb0);
  assert.equal((await instruction(0x65069)).operands[1].displacement,0x6c);
  assert.equal((await instruction(0x6507f)).target,0x249f10);
  assert.equal((await instruction(0x6508c)).target,0x249f10);
  assert.equal((await instruction(0x65091)).operands[0].displacement,0x28);
  assert.equal((await instruction(0x65091)).operands[1].value,0x12);
  assert.equal((await instruction(0x650a5)).target,facts.symbols.D3DDevice_CopyRects.address);
  assert.equal((await instruction(0x65162)).operands[1].displacement,0x6c);
  assert.equal((await instruction(0x65167)).target,0x242a50);
  assert.equal((await instruction(0x6516c)).operands[0].name,'EBP');
  assert.equal((await instruction(0x6516d)).target,0x242a50);
  assert.equal((await instruction(0x65179)).operands[0].value,12);
});

test('Heroes palette setter publishes stage palettes with the reviewed two-argument ABI',{skip:!enabled},async()=>{
  const address=facts.symbols.D3DDevice_SetPalette.address;
  assert.equal(address,0x2420d0);
  for(const at of [0x63baf,0x653ad])assert.equal((await instruction(at)).target,address);
  for(const at of [0x2420dd,0x2420ee,0x242115]){
    const i=await instruction(at);
    const m=i.operands.find(o=>o.kind==='mem');
    assert.equal(m.displacement,facts.layout.CDevice_Palettes.value);
    assert.equal(m.scale,4);
  }
  assert.equal((await instruction(0x24213e)).operands[1].displacement,4);
  assert.equal((await instruction(0x242146)).operands[1].value,0x41b20);
  assert.equal((await instruction(0x24215a)).operands[0].value,8);
});

test('Heroes sets a current diffuse attribute before array drawing',{skip:!enabled},async()=>{
  assert.equal((await instruction(0x97d1b)).operands[0].value,3);
  assert.equal((await instruction(0x97d1d)).target,0x24dbf0);
  assert.equal((await instruction(0x24dc07)).operands[1].displacement,0x41940);
  assert.equal((await instruction(0x24dc37)).operands[0].value,20);
  // These routines select indexed geometry after the constant attribute write.
  assert.equal((await instruction(0x97d71)).target,facts.symbols.D3DDevice_SetIndices.address);
});

test('Heroes surface-copy replacement matches source/destination traversal and five-argument ABI',{skip:!enabled},async()=>{
  const address=facts.symbols.D3DDevice_CopyRects.address;
  assert.equal(address,0x241560);
  assert.equal((await instruction(0x1044d9)).target,address);
  assert.equal((await instruction(0x650a5)).target,address);
  assert.equal((await instruction(0x657f7)).target,address);
  assert.equal((await instruction(0x241563)).operands[1].displacement,0x38);
  assert.equal((await instruction(0x241589)).operands[1].displacement,0x54);
  assert.equal((await instruction(0x241806)).operands[1].value,0xc4300);
  for(const at of [0x241874,0x241880])assert.equal((await instruction(at)).operands[0].value,20);
});

test('Heroes texture-coordinate selector stores the stage index and preserves its two-argument ABI',{skip:!enabled},async()=>{
  assert.equal(facts.symbols.D3DDevice_SetTextureState_TexCoordIndex.address,0x2445c0);
  assert.equal((await instruction(0xb1d68)).target,0x2445c0);
  assert.equal((await instruction(0x2445d4)).operands[1].value,7);
  assert.equal((await instruction(0x2445d7)).operands[0].displacement,facts.data.D3D_DeferredTextureState.address+28*4);
  assert.equal((await instruction(0x2446c2)).operands[0].value,8);
});

test('Heroes material and light wrappers preserve the original record sizes and enable ABI',{skip:!enabled},async()=>{
  assert.equal((await instruction(0x20d1ed)).target,facts.symbols.D3DDevice_SetMaterial.address);
  assert.equal((await instruction(0x241092)).operands[1].value,17);
  assert.equal((await instruction(0x241097)).mnemonic,'Movsd');
  assert.equal((await instruction(0x2410ad)).operands[0].value,4);
  assert.equal((await instruction(0x241c8e)).operands[1].value,26);
  assert.equal((await instruction(0x241c95)).mnemonic,'Movsd');
  assert.equal((await instruction(0x241e26)).target,facts.symbols.D3DDevice_SetLight.address);
  for(const at of [0x241b50,0x241db0,0x241ebb,0x241f0e])
    assert.equal((await instruction(at)).operands[0].value,8);
  assert.equal((await instruction(0x241e33)).operands[1].displacement,0x7c);
});

test('Heroes render-target and complex-state replacements match guest writes and calling conventions',{skip:!enabled},async()=>{
  for(const [at,offset]of [[0x2412e6,0x15e4],[0x24130f,0x15e8]])
    assert.equal((await instruction(at)).operands[0].displacement,offset);
  assert.equal(facts.symbols.D3DDevice_SetRenderTarget.address,0x241290);
  assert.equal((await instruction(0x241501)).operands[0].value,8);
  for(const [name,at,state,ret]of [
    ['ZEnable',0x244ff4,143,0x24502c],['StencilEnable',0x2450aa,144,0x2450b1],
    ['TextureFactor',0x24424a,148,0x244251],['PSTextureModes',0x243d3a,136,0x243d3f]]){
    assert.ok(facts.symbols['D3DDevice_SetRenderState_'+name]);
    assert.equal((await instruction(at)).operands[0].displacement,facts.data.D3D_RenderState.address+state*4);
    assert.equal((await instruction(ret)).operands[0].value,4);
  }
});

test('Heroes save-space calculation truncates GetDiskFreeSpaceEx byte counts to 32 bits',{skip:!enabled},async()=>{
  assert.equal((await instruction(0x2147a6)).target,0x58638);
  for(const [at,offset]of [[0x2147af,4],[0x2147b7,12]]){
    const i=await instruction(at);assert.equal(i.operands[0].kind,'reg');
    assert.equal(i.operands[1].size,4);assert.equal(i.operands[1].displacement,offset);
  }
  for(const at of [0x2147bb,0x2147c5]){
    const i=await instruction(at);assert.equal(i.mnemonic,'Shr');assert.equal(i.operands[1].value,14);
  }
});

test('Heroes device creation uses six stack arguments and publishes the reviewed device pointer',{skip:!enabled},async()=>{
  const returns=[];
  for(let at=facts.symbols.Direct3D_CreateDevice.address;at<0x24e983;){
    const i=await instruction(at);if(i.flow==='Return')returns.push(i.operands[0]?.value);at=i.next;
  }
  assert.deepEqual(returns,[24,24]);
  const device=await instruction(0x24e919),publish=await instruction(0x24e923);
  assert.equal(device.operands[1].value,0x251980);
  assert.equal(publish.operands[0].displacement,facts.data.D3D_pDevice.address);
  assert.equal(publish.operands[1].name,device.operands[0].name);
});

test('Heroes getters independently confirm target, depth and back/front buffer layouts',{skip:!enabled},async()=>{
  for(const [at,name]of [[0x241896,'CDevice_RenderTarget'],[0x2418b6,'CDevice_Depth'],[0x241525,'CDevice_BackBuffer']]){
    const i=await instruction(at);assert.equal(i.operands[1].displacement,facts.layout[name].value);
  }
  // The index=-1 path sets eax=1 before selecting base+eax*4.
  assert.equal((await instruction(0x24151f)).operands[1].value,1);
  assert.equal(facts.layout.CDevice_FrontBuffer.value,facts.layout.CDevice_BackBuffer.value+4);
});

test('Heroes texture-stage indexing and stream stride agree with renderer table layouts',{skip:!enabled},async()=>{
  assert.equal((await instruction(0x2447db)).operands[1].value,5);
  assert.equal(facts.layout.TextureState_Stage.value,2**5);
  assert.equal((await instruction(0x2447ec)).operands[0].displacement,facts.data.D3D_DeferredTextureState.address);
  assert.equal((await instruction(0x243812)).operands[0].displacement,facts.data.D3D_Streams?.address??0x253a00);
  assert.equal((await instruction(0x243818)).operands[0].displacement,0x253a00+facts.layout.Stream_Buffer.value);
});

test('graphics setup hook skips exactly the standalone MMIO write',{skip:!enabled},async()=>{
  const config=readFileSync(join(root,'native/config/heroes-hooks.toml'),'utf8');
  assert.match(config,/at = 0x0007E18D/);assert.match(config,/on_true = "0x0007E197"/);
  const i=await instruction(0x7e18d);
  assert.equal(i.mnemonic,'Mov');assert.equal(i.operands[0].displacement,0xfd400880);
  assert.equal(i.operands[0].base,'None');assert.equal(i.operands[0].index,'None');
  assert.equal(i.operands[1].value,0x28c7ff);assert.equal(i.next,0x7e197);
});

test('Heroes sound-effects offsets match library code and bound its imported descriptor table',{skip:!enabled},async()=>{
  for(const [at,name]of [[0x258d58,'EffectsImage_Skip1'],[0x258d5e,'EffectsImage_Skip0'],[0x258d67,'EffectsImage_Desc']]){
    const i=await instruction(at);assert.equal(i.operands[1].displacement,facts.layout[name].value);
  }
  const image=readFileSync(join(root,'local/game/assets/MpasFX.bin'));
  const countAt=facts.layout.EffectsImage_Desc.value+4*(image.readUInt32LE(facts.layout.EffectsImage_Skip0.value)+image.readUInt32LE(facts.layout.EffectsImage_Skip1.value));
  assert.ok(countAt+8<=image.length);
  const count=image.readUInt32LE(countAt);assert.equal(count,2);
  assert.ok(countAt+8+count*32<=image.length);
});

test('vertical blank event and callback fields resolve from Heroes miniport placement',{skip:!enabled},async()=>{
  const miniport=(await instruction(0x246f87)).operands[1].displacement;
  assert.equal(facts.layout.CDevice_VBlankCount.value,miniport+(await instruction(0x248934)).operands[1].displacement);
  assert.equal(facts.layout.CDevice_VBlankCallback.value,miniport+(await instruction(0x2489de)).operands[1].displacement);
  assert.equal(facts.layout.CDevice_VBlankEvent.value,miniport+(await instruction(0x2489d1)).operands[1].displacement);
  assert.equal((await instruction(0x2410d7)).operands[1].value,facts.layout.CDevice_VBlankEvent.value);
});

test('controller capabilities use the host query rather than dereferencing a virtual USB handle',{skip:!enabled},async()=>{
  assert.equal((await instruction(0x5ef6c)).target,facts.symbols.XInputGetCapabilities.address);
  const originalRead=await instruction(0x29178f);
  assert.equal(originalRead.operands[1].base,'EAX');assert.equal(originalRead.operands[1].displacement,0);
  assert.equal((await instruction(0x2917a8)).operands[0].value,6);
  assert.equal((await instruction(0x2917ad)).mnemonic,'Stosd');
  assert.equal((await instruction(0x2917af)).mnemonic,'Stosb');
  assert.equal((await instruction(0x29192a)).operands[1].value,1167);
  assert.equal((await instruction(0x291949)).operands[0].value,8);
});

test('resource and sound-format replacements preserve the original stack cleanup',{skip:!enabled},async()=>{
  for(const [name,count]of [['D3D_BlockOnTime',8],['D3D_BlockOnResource',4],['D3DResource_IsBusy',4],['D3DDevice_MakeSpace',0],['IDirectSoundBuffer_SetFormat',8],['IDirectSoundBuffer_SetNotificationPositions',12],['IDirectSoundBuffer_SetMixBins',8],['IDirectSoundBuffer_SetMixBinVolumes',8],['IDirectSoundBuffer_SetOutputBuffer',8],['D3DDevice_DrawVertices',12],['D3DDevice_DrawIndexedVertices',12],['D3DDevice_DrawVerticesUP',16],['D3DDevice_End',0]]){
    let at=facts.symbols[name].address,found=false;
    for(let n=0;n<300;n++){
      const i=await instruction(at);at=i.next;
      if(i.flow==='Return'){assert.equal(i.operands[0]?.value??0,count,name);found=true;break;}
    }
    assert.ok(found,name);
  }
});
