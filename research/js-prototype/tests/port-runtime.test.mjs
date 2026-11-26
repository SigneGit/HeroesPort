import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuestMemory } from '../runtime/memory.mjs';
import { Cpu,CF,ZF } from '../runtime/cpu.mjs';
import { Fpu } from '../runtime/fpu.mjs';
import { GuestKernel } from '../runtime/kernel.mjs';
import { GuestFileSystem,FileStatus } from '../runtime/filesystem.mjs';
import { decode } from '../tools/decode.mjs';
import { lift } from '../tools/lift.mjs';

function instruction(cpu,bytes){const i=decode(Buffer.from(bytes,'hex'),0x1000),code=lift(i);assert.ok(code.supported,code.reason);return new Function('s',code.body)(cpu);}
function cpuFixture(){const memory=new GuestMemory();memory.map(0x1000,Buffer.alloc(0x3000),{writable:true,executable:true});return new Cpu(memory);}
function kernelFixture(){const memory=new GuestMemory(),kernel=new GuestKernel(memory),thread=kernel.createThread({entry:0x1000,root:true});return {memory,kernel,thread};}
function syscall(kernel,thread,ordinal,args,fastcall=false){
  if(fastcall){thread.cpu.r[1]=args[0]??0;thread.cpu.r[2]=args[1]??0;args=args.slice(2);}
  const initial=thread.cpu.r[4];for(const value of [...args].reverse())thread.cpu.push(value);thread.cpu.push(0x12345678);
  const result=kernel.dispatch(thread,ordinal);if(result.handled&&thread.status!=='terminated'){assert.equal(thread.cpu.r[4],initial);assert.equal(thread.cpu.pc,0x12345678);}return {handled:result.handled,result:thread.cpu.r[0]};
}
function fileFixture(callback){
  const directory=mkdtempSync(join(tmpdir(),'heroes-fs-test-')),assets=join(directory,'assets'),userdata=join(directory,'userdata');
  mkdirSync(assets);writeFileSync(join(assets,'MiXeD.BIN'),Buffer.from([1,2,3,4]));
  const fs=new GuestFileSystem({assetsRoot:assets,userDataRoot:userdata,files:[{path:'MiXeD.BIN',size:4}]});
  try{return callback({fs,directory,assets,userdata});}finally{fs.dispose();rmSync(directory,{recursive:true,force:true});}
}

test('partial register moves preserve other bytes and sign/zero extensions differ',()=>{
  const cpu=cpuFixture();cpu.r[0]=0x12345678;
  instruction(cpu,'b0ff');assert.equal(cpu.r[0],0x123456ff);
  instruction(cpu,'b4ab');assert.equal(cpu.r[0],0x1234abff);
  instruction(cpu,'66b8feff');assert.equal(cpu.r[0],0x1234fffe);
  instruction(cpu,'0fbec0');assert.equal(cpu.r[0],0xfffffffe);
  instruction(cpu,'0fb6c0');assert.equal(cpu.r[0],254);
});
test('FS addressing uses the guest PCR; LEA ignores segment bases',()=>{
  const cpu=cpuFixture();cpu.fsBase=0x2000;cpu.mem.write32(0x2028,0xfeed1234);
  instruction(cpu,'64a128000000');assert.equal(cpu.r[0],0xfeed1234);
  instruction(cpu,'648d0528000000');assert.equal(cpu.r[0],0x28);
});
test('REP MOVS preserves overlapping forward order and backwards direction; STOS uses operand size',()=>{
  const cpu=cpuFixture();cpu.mem.write32(0x1000,7);cpu.mem.write32(0x1004,9);cpu.r[6]=0x1000;cpu.r[7]=0x1004;cpu.r[1]=2;
  instruction(cpu,'f3a5');assert.equal(cpu.mem.read32(0x1008),7);assert.equal(cpu.r[1],0);
  cpu.flags|=1024;cpu.r[6]=0x1004;cpu.r[7]=0x1014;cpu.r[1]=2;
  instruction(cpu,'f3a5');assert.equal(cpu.mem.read32(0x1014),7);assert.equal(cpu.mem.read32(0x1010),7);assert.equal(cpu.r[6],0xffc);
  cpu.flags&=~1024;cpu.r[7]=0x1020;cpu.r[1]=3;cpu.r[0]=0xaabbccdd;
  instruction(cpu,'f3aa');assert.deepEqual(cpu.mem.readBytes(0x1020,3),Buffer.from('dddddd','hex'));
  cpu.r[1]=0;cpu.r[6]=cpu.r[7]=0;instruction(cpu,'f3a5');
});
test('integer multiplication, unsigned division, SETcc and CMOVcc preserve semantics',()=>{
  const cpu=cpuFixture();cpu.r[0]=0xffffffff;cpu.r[1]=2;instruction(cpu,'f7e1');assert.equal(cpu.r[2],1);assert.equal(cpu.r[0],0xfffffffe);assert.equal(cpu.flags&CF,1);
  cpu.r[1]=3;instruction(cpu,'f7f1');assert.equal(cpu.r[0],0xaaaaaaaa);assert.equal(cpu.r[2],0);
  cpu.r[0]=10;cpu.r[1]=10;instruction(cpu,'39c8');instruction(cpu,'0f94c2');assert.equal(cpu.r[2]&255,1);
  cpu.r[1]=99;instruction(cpu,'0f44c1');assert.equal(cpu.r[0],99);
});
test('INC preserves an undefined carry and bit scans only define ZF',()=>{
  const cpu=cpuFixture();cpu.r[0]=0xffffffff;instruction(cpu,'40');assert.equal(cpu.r[0],0);assert.equal(cpu.known&CF,0);
  cpu.r[1]=0x80001000;instruction(cpu,'0fbcc1');assert.equal(cpu.r[0],12);assert.equal(cpu.known,ZF);
  instruction(cpu,'0fbdc1');assert.equal(cpu.r[0],31);
});
test('per-page commitment rejects reserved/decommitted access and crosses page permissions',()=>{
  const mem=new GuestMemory();mem.map(0x1000,Buffer.alloc(8192),{readable:false});
  assert.throws(()=>mem.read32(0x1000),/fault/);
  mem.protect(0x1000,4096,{readable:true,writable:true,executable:false});mem.write32(0x1000,4);
  assert.throws(()=>mem.read32(0x1ffe),/fault/);assert.throws(()=>mem.readBytes(0x1000,-1),/Invalid/);
  mem.protect(0x2000,4096,{readable:true,writable:true});mem.write32(0x1ffe,99);assert.equal(mem.read32(0x1ffe),99);
});
test('guest threads have separate FS/stack/TLS state and correct wrapper arguments',()=>{
  const {memory,kernel,thread}=kernelFixture(),out=kernel.allocate(4096,'outputs');
  const result=syscall(kernel,thread,255,[out,0,0x10000,148,out+4,0x2345,0x7788,1,0,0x4567]);assert.equal(result.result,0);
  const child=kernel.threads[1];assert.equal(child.status,'suspended');assert.equal(memory.read32(out),child.handle);assert.equal(memory.read32(out+4),child.id);
  assert.equal(child.cpu.pc,0x4567);assert.equal(memory.read32(child.cpu.r[4]+4),0x2345);assert.equal(memory.read32(child.cpu.r[4]+8),0x7788);
  assert.equal(memory.read32(child.fs+0x28),child.threadAddress);assert.equal(memory.read32(child.threadAddress+0x28),child.top-148);assert.notEqual(child.fs,thread.fs);
  assert.equal(memory.read32(child.threadAddress+0x12c),child.id);
  syscall(kernel,thread,224,[child.handle,out+8]);assert.equal(memory.read32(out+8),1);assert.equal(child.status,'ready');
  syscall(kernel,child,258,[7]);assert.equal(child.status,'terminated');assert.equal(child.exitCode,7);
});
test('thread creation rejects unsupported extensions instead of reporting success',()=>{
  const {kernel,thread}=kernelFixture(),out=kernel.allocate(4096,'out');
  assert.throws(()=>syscall(kernel,thread,255,[out,1,0x10000,0,0,0x2000,0,0,0,0]),/extensions/);assert.equal(kernel.threads.length,1);
});
test('critical sections track recursive ownership and reject cross-thread contention',()=>{
  const {kernel,thread,memory}=kernelFixture(),at=kernel.allocate(4096,'lock');syscall(kernel,thread,291,[at]);
  syscall(kernel,thread,277,[at]);syscall(kernel,thread,277,[at]);assert.equal(memory.read32(at+20),2);
  syscall(kernel,thread,294,[at]);assert.equal(memory.read32(at+20),1);
  const other=kernel.createThread({entry:0x2000,root:true});assert.throws(()=>syscall(kernel,other,277,[at]),/Contended/);
  syscall(kernel,thread,294,[at]);assert.equal(memory.read32(at+16),0xffffffff);assert.equal(memory.read32(at+24),0);
});
test('virtual memory reserve/commit/decommit/release honors page state and zero fill',()=>{
  const {kernel,thread,memory}=kernelFixture(),out=kernel.allocate(4096,'out');memory.write32(out,0);memory.write32(out+4,8192);
  assert.equal(syscall(kernel,thread,184,[out,0,out+4,0x2000,4]).result,0);const base=memory.read32(out);
  assert.throws(()=>memory.read32(base),/fault/);memory.write32(out+4,4096);
  syscall(kernel,thread,184,[out,0,out+4,0x1000,4]);memory.write32(base,123);
  syscall(kernel,thread,199,[out,out+4,0x4000]);assert.throws(()=>memory.read32(base),/fault/);
  syscall(kernel,thread,184,[out,0,out+4,0x1000,4]);assert.equal(memory.read32(base),0);
  memory.write32(out+4,0);syscall(kernel,thread,199,[out,out+4,0x8000]);assert.throws(()=>memory.read32(base),/fault/);
});
test('contiguous allocations honor physical limits, alignment and reuse freed ranges',()=>{
  const {kernel,thread}=kernelFixture();
  const a=syscall(kernel,thread,166,[8192,0,0x3ffffff,0x10000,4]).result;assert.equal(a%0x10000,0);assert.ok(a>=0x80000000&&a+8192<=0x84000000);
  syscall(kernel,thread,171,[a]);assert.equal(syscall(kernel,thread,166,[8192,0,0x3ffffff,0x10000,4]).result,a);
  assert.equal(syscall(kernel,thread,166,[0x4000001,0,0xffffffff,0,4]).result,0);
});
test('fastcall IRQL services consume register arguments and preserve caller stack',()=>{
  const {kernel,thread,memory}=kernelFixture();assert.equal(syscall(kernel,thread,129,[]).result,0);assert.equal(memory.read(thread.fs+0x24,1),2);
  syscall(kernel,thread,161,[0],true);assert.equal(memory.read(thread.fs+0x24,1),0);
});
test('timer arming/cancellation tracks state and does not invent DPC completion',()=>{
  const {kernel,thread,memory}=kernelFixture(),timer=kernel.allocate(4096,'timer');syscall(kernel,thread,113,[timer,0]);
  syscall(kernel,thread,149,[timer,0xffffff9c,0xffffffff,0]);kernel.advance(100n);assert.equal(memory.read32(timer+4),1);
  syscall(kernel,thread,149,[timer,0xffffff9c,0xffffffff,0x1234]);assert.throws(()=>kernel.advance(100n),/DPC/);
});
test('unsupported imports are explicit and preserve the call frame',()=>{
  const {kernel,thread}=kernelFixture();thread.cpu.push(2);thread.cpu.push(0x1234);const sp=thread.cpu.r[4];assert.equal(kernel.dispatch(thread,49).handled,false);assert.equal(thread.cpu.r[4],sp);
});
test('device creation supplies a real guest object and extension without host device access',()=>{
  const {kernel,thread,memory}=kernelFixture(),out=kernel.allocate(4096,'out');
  const result=syscall(kernel,thread,65,[0x1234,0x170,0,0x3a,0,out]);assert.equal(result.result,0);
  const object=memory.read32(out);assert.equal(memory.read32(object+8),0x1234);assert.equal(memory.read32(object+24),object+0x50);
  assert.equal(memory.read(object+30,1),1);assert.equal(memory.read(object+28,1),0x3a);assert.equal(kernel.devices.size,1);
});
test('x87 stack, binary64 arithmetic and integer stores handle supported modes',()=>{
  const cpu=cpuFixture();cpu.fpu.control=0x23f;cpu.fpu.push(2);cpu.fpu.push(3);instruction(cpu,'dec1');assert.deepEqual(cpu.fpu.stack,[5]);
  cpu.fpu.store(cpu.mem,0x1000,8,{pop:true});assert.equal(cpu.mem.readBytes(0x1000,8).readDoubleLE(),5);assert.throws(()=>cpu.fpu.pop(),/underflow/);
  cpu.fpu.push(2.5);cpu.fpu.store(cpu.mem,0x1000,4,{integer:true,pop:true});assert.equal(cpu.mem.read32(0x1000),2);
  const fpu=new Fpu();assert.throws(()=>fpu.binary('add',1,2),/binary64/);fpu.control=0x23f;assert.throws(()=>fpu.binary('div',1,0),/exceptional/);
  assert.equal(fpu.binary('add',0.1,0.2),0.1+0.2);assert.equal(fpu.status&32,32);
});
test('case-insensitive asset access stays read-only and supports synchronous offsets',()=>fileFixture(({fs})=>{
  const file=fs.open('D:\\mixed.bin',{desiredAccess:0x80000000});assert.deepEqual(fs.read(file,2),Buffer.from([1,2]));assert.deepEqual(fs.read(file,2,1),Buffer.from([2,3]));
  assert.throws(()=>fs.open('d:\\MIXED.bin',{desiredAccess:0x40000000}),FileStatus);
  assert.throws(()=>fs.write(file,Buffer.from([0])),FileStatus);
}));
test('guest file paths reject traversal, alternate streams and Windows device names',()=>fileFixture(({fs})=>{
  for(const name of ['d:\\..\\bad','d:\\file:stream','d:\\NUL.txt','d:\\bad.','d:\\x\\..\\bad'])assert.throws(()=>fs.open(name),FileStatus,name);
}));
test('user data directories/files persist while imported assets remain unchanged',()=>fileFixture(({fs,userdata,assets})=>{
  fs.link('E:','\\Device\\Harddisk0\\Partition1');
  fs.open('e:\\tdata',{options:1,disposition:3});
  const save=fs.open('e:\\tdata\\save.bin',{desiredAccess:0xc0000000,options:0x40,disposition:3});
  fs.write(save,Buffer.from('save'));fs.close(save);
  const reopened=fs.open('e:\\tdata\\save.bin');assert.equal(fs.read(reopened,4).toString(),'save');
  assert.equal(readFileSync(join(userdata,'tdata/save.bin')).toString(),'save');assert.deepEqual(readFileSync(join(assets,'MiXeD.BIN')),Buffer.from([1,2,3,4]));
}));
test('formatting utility cache gives a fresh namespace and preserves prior user data',()=>fileFixture(({fs,userdata})=>{
  fs.mountUtility(false);const first=fs.open('z:\\scratch.bin',{desiredAccess:0x40000000,disposition:3});fs.write(first,Buffer.from('old'));fs.close(first);
  fs.mountUtility(true);assert.throws(()=>fs.open('z:\\scratch.bin'),FileStatus);
  assert.equal(readFileSync(join(userdata,'cache/current/scratch.bin')).toString(),'old');
}));
test('host junctions cannot redirect guest user-data writes',()=>fileFixture(({fs,directory,userdata})=>{
  const outside=join(directory,'outside');mkdirSync(outside);
  try{symlinkSync(outside,join(userdata,'escape'),process.platform==='win32'?'junction':'dir');}catch(error){if(error.code==='EPERM')return;throw error;}
  assert.throws(()=>fs.open('\\Device\\Harddisk0\\Partition1\\escape\\bad.bin',{desiredAccess:0x40000000,disposition:3}),/links/);
}));
