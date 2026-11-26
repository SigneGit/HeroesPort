// Opt-in because these checks require the user's private game import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { root, loadGame } from '../../../tools/game-image.mjs';
import { GuestFileSystem } from '../runtime/filesystem.mjs';
import {createSession,runSession} from '../runtime/session.mjs';

test('supported user build reaches the first thread creation boundary with expected TLS and call ABI', {skip: process.env.HEROES_TEST_GAME !== '1'}, () => {
  const analysis = spawnSync(process.execPath, [join(root,'research/js-prototype/tools/analyze-startup.mjs')], {encoding:'utf8',cwd:root});
  assert.equal(analysis.status,0,analysis.stdout+analysis.stderr);
  const probe = spawnSync(process.execPath,[join(root,'research/js-prototype/tools/probe-startup.mjs'),'--stop-before-kernel'],{encoding:'utf8',cwd:root});
  assert.equal(probe.status,2,probe.stdout+probe.stderr);
  const result = JSON.parse(readFileSync(join(root,'local/recompiled/startup-trace.json')));
  const {memory,layout} = loadGame();
  const read = address => memory.readUInt32LE(address-layout.baseAddress);
  // Independently derive TLS allocation from the XBE TLS directory:
  // initialized template size + zero-fill, aligned to 16, plus the TLS pointer.
  const tls = layout.tlsAddress;
  const tlsSize = Math.ceil((read(tls+4)-read(tls)+read(tls+16))/16)*16+4;
  const tlsIndexAddress = read(tls+8);
  assert.equal(result.executedInstructions,50);
  assert.equal(result.stop.kind,'unsupported-kernel-import');
  assert.equal(result.stop.ordinal,255);
  assert.equal(result.stop.name,'PsCreateSystemThreadEx');
  assert.equal(Number(result.stop.returnAddress),0x563c2);
  assert.equal(Number(result.stop.arguments.tlsBytes),tlsSize);
  assert.equal(Number(result.stop.arguments.stackBytes),read(layout.baseAddress+0x130));
  assert.equal(Number(result.stop.arguments.startRoutine),0x55bed);
  assert.equal(Number(result.stop.arguments.systemRoutine),0x562eb);
  assert.equal(Number(result.stop.arguments.suspended),0);
  assert.equal(Number(result.stop.arguments.debuggerThread),0);
  assert.equal(Number(result.stop.arguments.startContext),0);
  assert.ok(result.writes.some(w=>w.address === tlsIndexAddress && (w.value|0) === -tlsSize/4));
  console.log(`User-build checkpoint: ${result.executedInstructions} instructions; TLS ${tlsSize} bytes; stop at kernel ordinal 255.`);
});

test('user build initializes guest TLS, heap and per-title storage before the explicit interrupt boundary', {skip:process.env.HEROES_TEST_GAME!=='1'}, async()=>{
  const directory=mkdtempSync(join(tmpdir(),'heroes-startup-test-'));
  const files=JSON.parse(readFileSync(join(root,'local/game/manifest.json'))).files;
  const fs=new GuestFileSystem({assetsRoot:join(root,'local/game/assets'),files,userDataRoot:join(directory,'userdata')});
  try{
    const {memory,layout}=loadGame(),module=await import(pathToFileURL(join(root,'local/recompiled/startup.mjs')).href);
    const session=createSession(memory,layout,module,{fileSystem:fs}),result=runSession(session,{limit:500000});
    assert.ok(result.executedInstructions>250000);
    assert.equal(result.stop.kind,'unsupported-kernel-import');assert.equal(result.stop.ordinal,44);
    assert.equal(result.stop.name,'HalGetInterruptVector');
    assert.equal(result.threads.length,2);assert.equal(result.threads[0].status,'terminated');
    const child=session.kernel.threads[1];assert.equal(session.mem.read32(child.tls),child.tls+4);
    assert.ok(result.kernelEvents.some(e=>e.name==='PsCreateSystemThreadEx'&&e.result===0));
    assert.ok(result.kernelEvents.filter(e=>e.name==='NtAllocateVirtualMemory'&&e.result===0).length>=2);
    assert.ok(result.kernelEvents.some(e=>e.kind==='xdk-bridge'&&e.name==='XMountUtilityDrive'));
    assert.equal(result.kernelEvents.filter(e=>e.kind==='crt-bridge'&&e.name==='CrtPowX87').length,128);
    assert.ok(result.fileEvents.some(e=>e.kind==='write'&&e.path.endsWith('titleimage.xbx')&&e.size===10240));
    assert.ok(result.traceTruncated>0);assert.ok(result.trace.length<=4608);
    console.log(`Extended user-build checkpoint: ${result.executedInstructions} instructions, two threads, private file output, explicit interrupt stop.`);
  }finally{fs.dispose();rmSync(directory,{recursive:true,force:true});}
});
