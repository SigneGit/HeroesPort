import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GuestMemory } from '../runtime/memory.mjs';
import { Cpu, CF, PF, AF, ZF, SF, OF } from '../runtime/cpu.mjs';
import { decode, discover } from '../tools/decode.mjs';
import { lift, emitModule } from '../tools/lift.mjs';
import { Fpu } from '../runtime/fpu.mjs';

function machine() {
  const memory = new GuestMemory();
  memory.map(0x1000, Buffer.alloc(0x1000), { writable: true, executable: true });
  const cpu = new Cpu(memory); cpu.r[4] = 0x2000;
  return cpu;
}
function operation(bytes, address = 0x1000) {
  const instruction = decode(Buffer.from(bytes, 'hex'), address);
  const lifted = lift(instruction);
  assert.ok(lifted.supported, lifted.reason);
  return new Function('s', lifted.body);
}
test('memory faults on unmapped, read-only, nonexecutable and wrapping accesses', () => {
  const memory = new GuestMemory();
  memory.map(0x1000, Buffer.alloc(8));
  assert.throws(() => memory.write32(0x1000, 1), /write fault/);
  assert.throws(() => memory.read32(0x1005), /read fault/);
  assert.throws(() => memory.read32(0xfffffffe), /Invalid guest/);
  assert.throws(() => memory.region(0x1000, 1, 'execute'), /execute fault/);
  assert.throws(() => memory.map(0x1004, Buffer.alloc(8)), /Overlapping/);
});
test('writes to translated instructions trap before memory changes', () => {
  const cpu = machine(); cpu.mem.protectTranslatedCode([[0x1004,3]]);
  assert.throws(() => cpu.mem.write32(0x1001,0xffffffff),/Self-modifying/);
  assert.equal(cpu.mem.read32(0x1001),0);
  cpu.mem.write32(0x1008,123); assert.equal(cpu.mem.read32(0x1008),123);
});
test('translated synthetic calls, memory arguments and stdcall returns balance the stack', () => {
  const cpu = machine();
  operation('6a07')(cpu); // push 7
  assert.equal(operation('e8fb000000', 0x1002)(cpu), 0x1102); // call
  assert.equal(cpu.mem.read32(cpu.r[4]), 0x1007);
  operation('8b442404')(cpu); // mov eax,[esp+4]
  assert.equal(cpu.r[0], 7);
  assert.equal(operation('c20400')(cpu), 0x1007);
  assert.equal(cpu.r[4], 0x2000);
});
test('push esp reads old value; pop esp installs popped value', () => {
  const cpu = machine();
  operation('54')(cpu);
  assert.equal(cpu.mem.read32(0x1ffc), 0x2000);
  operation('5c')(cpu);
  assert.equal(cpu.r[4], 0x2000);
});
test('translated memory indirect call computes target before pushing return address', () => {
  const cpu = machine(); cpu.push(0x1122);
  assert.equal(operation('ff1424')(cpu), 0x1122);
  assert.equal(cpu.mem.read32(cpu.r[4]), 0x1003);
});
test('cdq/idiv preserve signed quotient and remainder and reject divide errors', () => {
  const cpu = machine(); cpu.r[0] = -149;
  operation('99')(cpu); cpu.r[1] = 4;
  operation('f7f9')(cpu);
  assert.equal(cpu.r[0] | 0, -37); assert.equal(cpu.r[2] | 0, -1);
  assert.throws(() => cpu.condition('Je'), /Undefined/);
  const before = [...cpu.r];
  assert.throws(() => cpu.idiv(0), /zero/); assert.deepEqual([...cpu.r], before);
  cpu.r[0] = 0x80000000; cpu.r[2] = 0xffffffff;
  assert.throws(() => cpu.idiv(-1), /overflow/);
});
test('arithmetic and logic flags handle carry, signed overflow and parity', () => {
  const cpu = machine();
  assert.equal(cpu.arithmetic('add', 0xffffffff, 1), 0);
  assert.equal(cpu.flags & (CF | ZF | PF | AF | OF | SF), CF | ZF | PF | AF);
  cpu.arithmetic('add', 0x7fffffff, 1); assert.equal(cpu.flags & (OF | SF | CF), OF | SF);
  cpu.arithmetic('sub', 0x80000000, 1); assert.equal(cpu.flags & (OF | SF | CF), OF);
  cpu.logic('xor', 5, 5); assert.equal(cpu.condition('Je'), true); assert.equal(cpu.known & AF, 0);
});
test('shr masks count, preserves flags on zero, and marks multi-bit overflow undefined', () => {
  const cpu = machine(); cpu.arithmetic('sub', 0, 1);
  const flags = cpu.flags, known = cpu.known;
  assert.equal(cpu.shr(0x80000001, 32), 0x80000001); assert.equal(cpu.flags, flags); assert.equal(cpu.known, known);
  assert.equal(cpu.shr(0x80000001, 1), 0x40000000); assert.equal(cpu.flags & (CF | OF), CF | OF);
  cpu.shr(7, 2); assert.throws(() => cpu.condition('Jge'), /Undefined/);
});
test('lifter rejects GS, 16-bit addressing, unsupported x87 and repeat prefixes', () => {
  for (const bytes of ['65a124000000','678b00','d9f1','f390']) {
    const lifted = lift(decode(Buffer.from(bytes, 'hex'), 0x1000));
    assert.equal(lifted.supported, false, bytes);
    assert.throws(() => new Function('s', lifted.body)(machine()), /Unsupported/);
  }
});
test('recursive discovery stops at return and excludes adjacent padding', () => {
  const memory = Buffer.from('e801000000c3b807000000c3cccc', 'hex');
  const graph = discover(memory, { baseAddress: 0x1000, entryPoint: 0x1000, sections: [{address: 0x1000, executable: true, fileSize: memory.length}] });
  assert.deepEqual(graph.instructions.map(i => i.address), [0x1000,0x1005,0x1006,0x100b]);
  assert.deepEqual(graph.functionCandidates, [0x1000,0x1006]); assert.deepEqual(graph.conflicts, []);
  assert.throws(() => discover(memory, { baseAddress: 0x1000, entryPoint: 0x1000, sections: [{address: 0x1000, executable: true, fileSize: memory.length}] }, {maxInstructions: 1}), /limit/);
});
test('generated module executes translated code without a decoder', async () => {
  const instructions = [decode(Buffer.from('b82a000000', 'hex'), 0x1000), decode(Buffer.from('c3','hex'),0x1005)];
  const source = emitModule(instructions, 'synthetic');
  assert.ok(!source.includes('import '));
  const {translated,fingerprint} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  assert.equal(fingerprint,'synthetic');
  const cpu = machine(); cpu.push(0x1234);
  assert.equal(translated.get(0x1000)(cpu),0x1005); assert.equal(cpu.r[0],42);
  assert.equal(translated.get(0x1005)(cpu),0x1234);
});

const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
test('arithmetic result and defined flags match host x86 hardware for boundary/random vectors', { skip: process.platform !== 'win32' || process.arch !== 'x64' || !existsSync(compiler) }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'heroes-native-test-'));
  try {
    const executable = join(directory, 'oracle.exe');
    const compilation = spawnSync(compiler, ['/nologo','/platform:x64',`/out:${executable}`,resolve('research/js-prototype/tests/native/ArithmeticOracle.cs')], { encoding:'utf8' });
    assert.equal(compilation.status,0,compilation.stdout + compilation.stderr);
    let seed = 0x12345678;
    const random = () => {seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;return seed >>> 0;};
    const values = [0,1,2,15,16,31,32,127,128,255,256,0x7fffffff,0x80000000,0xfffffffe,0xffffffff];
    const vectors = [];
    const kinds=['add','sub','and','or','xor','shr','adc','sbb','sar','shl',...['8','16'].flatMap(width=>['add','sub','and','or','xor'].map(kind=>kind+width))];
    for (const kind of kinds) {
      for (const a of values) for (const b of values) vectors.push({kind,a,b});
      for(let i=0;i<200;i++) vectors.push({kind,a:random(),b:random()});
    }
    const run = spawnSync(executable,[],{input:vectors.map(v=>`${v.kind} ${v.a} ${v.b}`).join('\n')+'\n',encoding:'utf8',maxBuffer:4*1024*1024});
    assert.equal(run.status,0,run.stderr);
    const lines = run.stdout.trim().split(/\r?\n/); assert.equal(lines.length,vectors.length);
    const cpu = machine();
    vectors.forEach(({kind,a,b},i)=>{
      // A zero-count shift preserves input flags, which aren't controlled in the
      // separate hardware function. Compare value only for those vectors.
      const match=kind.match(/^(.*?)(8|16)?$/),op=match[1],width=Number(match[2]??32);
      if(['adc','sbb'].includes(op)){cpu.flags|=CF;cpu.known|=CF;}
      const result = ['add','sub','adc','sbb'].includes(op) ? cpu.arithmetic(op,a,b,width) : ['shr','sar','shl'].includes(op) ? cpu.shift(op,a,b,width) : cpu.logic(op,a,b,width);
      const [nativeResult,nativeFlags] = lines[i].split(' ').map(Number);
      assert.equal(result,nativeResult%2**width,`${kind} ${a} ${b} value`);
      if (!['shr','sar','shl'].includes(kind) || (b & 31)) assert.equal(cpu.flags & cpu.known,nativeFlags & cpu.known,`${kind} ${a} ${b} flags`);
    });
    console.log(`Compared ${vectors.length} arithmetic vectors with native x86 CPU results/flags.`);
    const conversions=[];
    for(let mode=0;mode<4;mode++)for(const value of [0,0.5,1.5,2.5,-0.5,-1.5,-2.5,1.1,-1.1,127.7,-128.7,2147483648]){
      const bytes=Buffer.alloc(4);bytes.writeFloatLE(value);
      conversions.push({value:bytes.readFloatLE(),raw:bytes.readUInt32LE(),control:0x37f|(mode<<10)});
    }
    const roundRun=spawnSync(executable,[],{input:conversions.map(v=>`x87round ${v.raw} ${v.control}`).join('\n')+'\n',encoding:'utf8'});
    assert.equal(roundRun.status,0,roundRun.stderr);
    const roundLines=roundRun.stdout.trim().split(/\r?\n/);assert.equal(roundLines.length,conversions.length);
    conversions.forEach((v,i)=>{
      const fpu=new Fpu();fpu.control=v.control;fpu.push(v.value);fpu.store(cpu.mem,0x1000,4,{integer:true,pop:true});
      const [value,status]=roundLines[i].split(' ').map(Number);
      assert.equal(cpu.mem.read32(0x1000),value,`x87 rounding ${v.value} ${v.control}`);
      assert.equal(fpu.status&0x21,status&0x21,`x87 status ${v.value} ${v.control}`);
    });
    console.log(`Compared ${conversions.length} x87 integer conversions with host CPU rounding/status.`);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
