import { GuestMemory } from './memory.mjs';
import { GuestKernel, kernelAbi } from './kernel.mjs';
import { hex } from '../../../tools/xbe.mjs';
import profile from '../config/virtual-xbox.json' with {type:'json'};
import xdk from '../config/xdk-bridges.json' with {type:'json'};
import {kernelServices} from './kernel-imports.mjs';

export function createSession(memory,layout,module,{fileSystem=null}={}) {
  if(module.fingerprint!==layout.sha256)throw new Error('Generated translation fingerprint mismatch; rerun analyze-startup');
  const mem=new GuestMemory();
  mem.map(layout.baseAddress,memory.subarray(0,layout.headersSize),{name:'xbe_headers',writable:true});
  for(const section of layout.sections)if(section.virtualSize)mem.map(section.address,memory.subarray(section.address-layout.baseAddress,section.address-layout.baseAddress+section.virtualSize),{name:section.name,writable:section.writable,executable:section.executable});
  const kernel=new GuestKernel(mem,{fileSystem,image:{layout,memory}});kernel.initializeDataExports();
  if(profile.launchMedium==='imported-files'){
    // This port launches a verified executable from imported files on virtual
    // storage. Adjust only the in-memory loader certificate's media descriptor;
    // the user's original XBE remains unmodified and fingerprint-checked.
    const certificate=mem.read32(layout.baseAddress+0x118);
    mem.write32(certificate+0x9c,1);
    const originalSecurityFlags=mem.read32(certificate+0x1d8);
    mem.write32(certificate+0x1d8,originalSecurityFlags&~1);
    kernel.events.push({kind:'loader-media',medium:'imported-files',certificateAllowedMedia:1,originalSecurityFlags,inMemorySecurityFlags:originalSecurityFlags&~1});
  }
  const traps=new Map();
  for(const imported of layout.kernelImports){
    const target=kernel.dataExports.get(imported.ordinal)??(0xff000000+imported.ordinal*16),region=mem.region(imported.slot,4);
    // Function sentinels are never executable host addresses. Unimplemented data
    // exports stay unmapped and fault if dereferenced instead of returning fake data.
    region.bytes.writeUInt32LE(target,imported.slot-region.address);
    if(!kernel.dataExports.has(imported.ordinal))traps.set(target,imported.ordinal);
  }
  mem.protectTranslatedCode(module.instructionRanges);
  kernel.createThread({entry:layout.entryPoint,root:true});
  mem.writes.length=0;
  return {mem,kernel,traps,module,layout};
}
export function runSession(session,{limit=200000,stopBeforeKernel=false}={}) {
  const {mem,kernel,traps,module,layout}=session;
  let thread=kernel.threads[0],stop,executed=0;
  const traceHead=[],traceTail=new Array(4096);
  const choose=()=>{
    const current=kernel.threads.indexOf(thread);
    for(let n=1;n<=kernel.threads.length;n++){
      const next=kernel.threads[(current+n)%kernel.threads.length];
      if(next.status==='ready'){thread=next;return true;}
    }
    return false;
  };
  while(executed<limit){
    const cpu=thread.cpu;
    if(thread.status!=='ready'){if(!choose()){stop={kind:'no-runnable-threads'};break;}continue;}
    if(cpu.pc===thread.returnSentinel){thread.status='terminated';thread.exitCode=cpu.r[0];mem.write32(thread.threadAddress+4,1);kernel.events.push({kind:'thread-returned',thread:thread.id,exitCode:cpu.r[0]});if(!choose()){stop={kind:'all-threads-terminated'};break;}continue;}
    try {
      const bridge=layout.sha256===xdk.xbeSha256?xdk.bridges.find(b=>Number(b.address)===cpu.pc):undefined;
      if(bridge){
        if(bridge.name==='XMountUtilityDrive'){
          if(!kernel.fileSystem)throw new Error('Utility mount needs a filesystem');
          const formatClean=!!mem.read32(cpu.r[4]+4);kernel.fileSystem.mountUtility(formatClean);
          kernel.events.push({kind:'xdk-bridge',thread:thread.id,name:bridge.name,address:cpu.pc,formatClean});
          kernel.complete(cpu,{convention:'stdcall',argumentBytes:bridge.argumentBytes},1);
        }else if(bridge.name==='CrtPowX87'){
          if(((cpu.fpu.control>>>8)&15)!==2)throw new Error('CRT pow bridge requires binary64 precision and nearest rounding');
          const exponent=cpu.fpu.get(),base=cpu.fpu.get(1),value=Math.pow(base,exponent);
          if(!Number.isFinite(value)||(value===0&&base!==0))throw new Error('Exceptional CRT pow is not implemented');
          cpu.fpu.pop();cpu.fpu.pop();cpu.fpu.push(value);
          kernel.events.push({kind:'crt-bridge',thread:thread.id,name:bridge.name,base,exponent,value});
          kernel.complete(cpu,{convention:'stdcall',argumentBytes:0});
        }else throw new Error('Unsupported XDK bridge');
        continue;
      }
      if(traps.has(cpu.pc)){
        const ordinal=traps.get(cpu.pc),service=kernelAbi.get(ordinal);
        if(!stopBeforeKernel){
          const dispatched=kernel.dispatch(thread,ordinal);
          if(dispatched.handled){if(mem.read(cpu.fsBase+0x24,1)===0&&(cpu.flags&512))choose();continue;}
        }
        const values=Array.from({length:(service?.argumentBytes??0)/4},(_,i)=>hex(service.convention==='fastcall'&&i<2?cpu.r[i===0?1:2]:mem.read32(cpu.r[4]+4+(i-(service.convention==='fastcall'?2:0))*4)));
        const names=kernelServices.get(ordinal)?.argumentNames;
        stop={kind:'unsupported-kernel-import',thread:thread.id,ordinal,name:service?.name??'unresolved',target:hex(cpu.pc),returnAddress:hex(mem.read32(cpu.r[4])),arguments:names?Object.fromEntries(names.map((name,i)=>[name,values[i]])):values};
        break;
      }
      const operation=module.translated.get(cpu.pc);
      if(!operation){stop={kind:'untranslated-target',thread:thread.id,address:hex(cpu.pc)};break;}
      mem.region(cpu.pc,1,'execute');
      const frame={step:executed,thread:thread.id,...cpu.snapshot(),assembly:module.descriptions.get(cpu.pc)};
      cpu.pc=operation(cpu)>>>0;executed++;
      if(executed<=512)traceHead.push(frame);else traceTail[(executed-513)%traceTail.length]=frame;
      kernel.advance();
    }catch(error){stop={kind:'execution-error',thread:thread.id,address:hex(cpu.pc),message:error.message};break;}
  }
  stop??={kind:'instruction-limit',limit};
  const trace=[...traceHead];
  const tailCount=Math.min(Math.max(0,executed-512),traceTail.length),tailStart=executed-512>traceTail.length?(executed-512)%traceTail.length:0;
  for(let i=0;i<tailCount;i++)trace.push(traceTail[(tailStart+i)%traceTail.length]);
  return {fingerprint:layout.sha256,harness:'cooperative diagnostic guest runtime; incomplete Xbox kernel and hardware model',executedInstructions:executed,stop,finalState:thread.cpu.snapshot(),threads:kernel.threads.map(t=>({id:t.id,status:t.status,tls:t.tls,tlsBytes:t.tlsBytes,threadAddress:t.threadAddress,fs:t.fs,stack:t.stack,top:t.top,exitCode:t.exitCode,state:t.cpu.snapshot()})),kernelEvents:kernel.events,fileEvents:kernel.fileSystem?.events??[],writes:mem.writes,trace,traceTruncated:Math.max(0,executed-trace.length)};
}
