import abi from '../config/kernel-abi.json' with {type:'json'};
import { Cpu } from './cpu.mjs';
import profile from '../config/virtual-xbox.json' with {type:'json'};
import { FileStatus } from './filesystem.mjs';

export const kernelAbi = new Map(abi.services.map(service=>[service.ordinal,service]));
const page = n => Math.ceil(n/4096)*4096;
export class GuestKernel {
  constructor(memory,{fileSystem=null,image=null}={}) {
    this.mem=memory; this.nextAddress=0x10000000; this.allocated=0;
    this.threads=[]; this.handles=new Map(); this.events=[]; this.locks=new Map(); this.shutdownNotifications=new Map(); this.timers=new Map();this.dpcs=new Map();
    this.dataExports=new Map();
    this.time=0n;this.virtualAllocations=new Map();this.contiguous=new Map();this.nextPhysical=0x80400000;
    this.fileSystem=fileSystem;this.nextHandle=0x1000;this.image=image;
    this.devices=new Map();this.pool=new Map();this.guestEvents=new Map();
    this.pinnedPages=new Map();
  }
  string(at) {
    const length=this.mem.read(at,2),pointer=this.mem.read32(at+4);
    if(length>32767)throw new Error('Guest string exceeds limit');
    return length?this.mem.readBytes(pointer,length).toString('latin1'):'';
  }
  newHandle(object) {const handle=this.nextHandle;this.nextHandle+=4;this.handles.set(handle,object);return handle;}
  advance(ticks=100n) {
    this.time+=ticks;
    const tick=this.dataExports.get(156);
    if(tick){const ms=this.time/10000n;if(ms!==this.lastTick){this.mem.write32(tick,Number(ms&0xffffffffn));this.mem.write32(tick+4,Number(ms>>32n));this.mem.write32(tick+8,Number(ms>>32n));this.lastTick=ms;}}
    for(const [at,timer] of this.timers)if(timer.armed&&timer.due<=this.time){
      timer.armed=false;timer.signaled=true;this.mem.write32(at+4,1);
      if(timer.dpc)throw new Error('Timer DPC dispatch is not implemented');
    }
  }
  initializeDataExports() {
    const data=(ordinal,size,initialize)=>{
      const address=this.allocate(size,`kernel_data_${kernelAbi.get(ordinal).name}`);
      initialize(address);this.dataExports.set(ordinal,address);
    };
    data(322,8,at=>{this.mem.write32(at,profile.hardwareFlags);this.mem.write(at+4,profile.gpuRevision,1);this.mem.write(at+5,profile.mcpRevision,1);});
    data(324,8,at=>profile.kernelVersion.forEach((value,i)=>this.mem.write(at+i*2,value,2)));
    data(164,4,()=>{}); // Null LaunchDataPage: cold launch, no launch payload.
    data(156,12,()=>{}); // Deterministic time starts at zero; advanced by the scheduler.
    data(326,256,at=>{
      const name=Buffer.from('\\Device\\Harddisk0\\Partition1\\Heroes\\default.xbe\0','ascii');
      this.mem.write(at,name.length-1,2);this.mem.write(at+2,name.length,2);this.mem.write32(at+4,at+8);
      for(let i=0;i<name.length;i++)this.mem.write(at+8+i,name[i],1);
    });
    // Metadata for this virtual kernel. No firmware bytes or executable kernel
    // code are mapped. Legacy startup scans the final section for an INIT image.
    const header=Buffer.alloc(4096);header.write('MZ');header.writeUInt32LE(0x80,0x3c);header.write('PE\0\0',0x80);
    header.writeUInt16LE(0x14c,0x84);header.writeUInt16LE(1,0x86);header.writeUInt16LE(0xe0,0x94);header.writeUInt16LE(0x10b,0x98);
    header.write('.text',0x178);
    this.mem.map(0x80010000,header,{name:'virtual_kernel_metadata'});
    // The linked XDK allocator uses the remainder of physical page zero as its
    // small bootstrap pool before falling back to ExAllocatePoolWithTag.
    this.mem.map(0x80000000,Buffer.alloc(4096),{name:'xdk_bootstrap_pool',writable:true});
  }
  allocate(size,name,{readable=true,writable=true,executable=false}={}) {
    size=page(size);
    if(!Number.isSafeInteger(size)||size<=0||size>32*1024*1024||this.allocated+size>64*1024*1024)throw new Error('Guest allocation limit exceeded');
    const address=this.nextAddress;
    this.mem.map(address,Buffer.alloc(size),{name,readable,writable,executable});
    this.nextAddress+=size+4096;this.allocated+=size;
    return address;
  }
  createThread({entry,stackBytes=0x100000,tlsBytes=0,startRoutine=0,startContext=0,systemRoutine=0,suspended=false,root=false}) {
    stackBytes=page(stackBytes||0x10000);
    if(tlsBytes>stackBytes-256)throw new Error('TLS allocation exceeds thread stack');
    const id=this.threads.length+1, stack=this.allocate(stackBytes,`thread_${id}_stack`), top=stack+stackBytes;
    const threadAddress=this.allocate(0x200,`thread_${id}_object`);
    const fs=this.allocate(0x1000,`thread_${id}_pcr`),prcb=this.allocate(0x1000,`thread_${id}_prcb`);
    const tls=top-tlsBytes;
    this.mem.write32(threadAddress+0x1c,top);this.mem.write32(threadAddress+0x20,stack);
    this.mem.write32(threadAddress+0x28,tls);
    this.mem.write32(threadAddress+0x12c,id);
    this.mem.write32(fs,0xffffffff);this.mem.write32(fs+4,top);this.mem.write32(fs+8,stack);
    this.mem.write32(fs+0x18,fs);this.mem.write32(fs+0x1c,fs);this.mem.write32(fs+0x20,prcb);this.mem.write32(fs+0x28,threadAddress);
    const cpu=new Cpu(this.mem);cpu.fsBase=fs;cpu.r[4]=tls&~15;
    const returnSentinel=0xffff0000+id*16;
    if(!root){cpu.push(startContext);if(systemRoutine)cpu.push(startRoutine);}
    cpu.push(returnSentinel);cpu.pc=systemRoutine||entry||startRoutine;
    const thread={id,cpu,stack,top,tls,tlsBytes,threadAddress,fs,prcb,returnSentinel,status:suspended?'suspended':'ready',suspendCount:suspended?1:0};
    thread.handle=this.newHandle({kind:'thread',thread});this.threads.push(thread);
    this.events.push({kind:'thread-created',thread:id,entry:cpu.pc,startRoutine,systemRoutine,tlsBytes,stackBytes,status:thread.status});
    return thread;
  }
  complete(cpu,service,result) {
    if(!['stdcall','fastcall'].includes(service.convention))throw new Error(`Unsupported kernel calling convention ${service.convention}`);
    const cleanup=service.convention==='fastcall'?Math.max(0,service.argumentBytes-8):service.argumentBytes;
    const target=cpu.pop();cpu.r[4]=(cpu.r[4]+cleanup)>>>0;cpu.pc=target;
    if(result!==undefined)cpu.r[0]=result;
    cpu.known=0;
  }
  dispatch(thread,ordinal) {
    const cpu=thread.cpu,service=kernelAbi.get(ordinal);
    if(!service)throw new Error(`Unknown kernel ordinal ${ordinal}`);
    const args=Array.from({length:(service.argumentBytes??0)/4},(_,i)=>service.convention==='fastcall'&&i<2?cpu.r[i===0?1:2]:this.mem.read32(cpu.r[4]+4+(i-(service.convention==='fastcall'?2:0))*4));
    const event={kind:'kernel-call',thread:thread.id,ordinal,name:service.name,args};
    this.events.push(event);
    let result;
    try { switch(service.name) {
      case 'MmLockUnlockBufferPages': {
        const [at,length,unlock]=args;this.mem.region(at,length);
        for(let p=Math.floor(at/4096)*4096;p<at+length;p+=4096){
          const count=this.pinnedPages.get(p)??0;
          if(unlock&&!count)throw new Error('Unlock of an unpinned guest page');
          if(unlock&&count===1)this.pinnedPages.delete(p);else this.pinnedPages.set(p,count+(unlock?-1:1));
        }
        break;
      }
      case 'IoCreateDevice': {
        const [driver,extensionSize,namePointer,type,exclusive,out]=args;
        this.mem.region(out,4,'write');
        const name=namePointer?this.string(namePointer).toLowerCase():null;
        if(name&&[...this.devices.values()].some(d=>d.name===name)){result=0xc0000035;break;}
        if(extensionSize>0xffff-0x4c){result=0xc0000017;break;}
        const at=this.allocate(0x50+extensionSize,'device_object'),extension=at+0x50;
        this.mem.write(at,3,2);this.mem.write(at+2,0x4c+extensionSize,2);this.mem.write32(at+4,1);
        this.mem.write32(at+8,driver);this.mem.write32(at+12,at);this.mem.write32(at+20,0x10|(exclusive?8:0));this.mem.write32(at+24,extension);
        this.mem.write(at+28,type,1);this.mem.write(at+30,1,1);this.mem.write32(at+32,512);
        this.mem.write(at+40,4,2);this.mem.write(at+42,16,2);this.mem.write32(at+44,at+44);this.mem.write32(at+48,at+44);
        this.mem.write(at+56,1,1);this.mem.write(at+58,4,1);this.mem.write32(at+60,1);this.mem.write32(at+64,at+64);this.mem.write32(at+68,at+64);
        this.devices.set(at,{name,driver,extension,type});this.mem.write32(out,at);result=0;break;
      }
      case 'ExAllocatePoolWithTag': {
        if(args[0]===0){result=0;break;}
        result=this.allocate(args[0],'kernel_pool');this.pool.set(result,{size:page(args[0]),tag:args[1]});break;
      }
      case 'ExFreePool': {
        if(!args[0])break;const allocation=this.pool.get(args[0]);if(!allocation)throw new Error('Invalid pool free');
        this.mem.regions=this.mem.regions.filter(r=>r.address!==args[0]);this.allocated-=allocation.size;this.pool.delete(args[0]);break;
      }
      case 'ExQueryPoolBlockSize':
        if(!this.pool.has(args[0]))throw new Error('Unknown pool allocation');result=this.pool.get(args[0]).size;break;
      case 'KeInitializeEvent': {
        const [at,type,state]=args;if(type>1)throw new Error('Invalid event type');
        this.mem.region(at,16,'write');this.mem.write(at,type,1);this.mem.write(at+2,4,1);this.mem.write32(at+4,state?1:0);this.mem.write32(at+8,at+8);this.mem.write32(at+12,at+8);
        this.guestEvents.set(at,{type,signaled:!!state});break;
      }
      case 'KeRaiseIrqlToDpcLevel':case 'KfRaiseIrql':case 'KfLowerIrql': {
        const old=this.mem.read(cpu.fsBase+0x24,1),value=service.name==='KeRaiseIrqlToDpcLevel'?2:args[0]&255;
        if(value>31||(service.name==='KfLowerIrql'?value>old:value<old))throw new Error('Invalid guest IRQL transition');
        this.mem.write(cpu.fsBase+0x24,value,1);if(service.name!=='KfLowerIrql')result=old;break;
      }
      case 'NtOpenSymbolicLinkObject': {
        if(!this.fileSystem)return {handled:false,service,args};
        const name=this.string(this.mem.read32(args[1]+4)).toLowerCase().replace(/^\\\?\?\\/,'');
        const target=this.fileSystem.links.get(name);
        if(target===undefined){result=0xc0000034;break;}
        this.mem.write32(args[0],this.newHandle({kind:'symlink',target}));result=0;break;
      }
      case 'NtQuerySymbolicLinkObject': {
        const object=this.handles.get(args[0]);
        if(object?.kind!=='symlink'){result=0xc0000008;break;}
        const bytes=Buffer.from(object.target,'latin1'),maximum=this.mem.read(args[1]+2,2);
        if(args[2])this.mem.write32(args[2],bytes.length);
        if(maximum<bytes.length){result=0xc0000023;break;}
        this.mem.writeBytes(this.mem.read32(args[1]+4),bytes);this.mem.write(args[1],bytes.length,2);result=0;break;
      }
      case 'XeLoadSection':case 'XeUnloadSection': {
        if(!this.image)return {handled:false,service,args};
        const {layout,memory}=this.image,table=this.mem.read32(layout.baseAddress+0x120),index=(args[0]-table)/56;
        if(!Number.isInteger(index)||index<0||index>=layout.sections.length){result=0xc000000d;break;}
        const section=layout.sections[index],region=this.mem.regions.find(r=>r.address===section.address),reference=args[0]+24,count=this.mem.read32(reference);
        if(service.name==='XeLoadSection'){
          if(count===0){
            memory.copy(region.bytes,0,section.address-layout.baseAddress,section.address-layout.baseAddress+section.virtualSize);
            region.readable=true;region.writable=section.writable;region.executable=section.executable;
          }
          this.mem.write32(reference,count+1);
        }else {
          if(!count){result=0xc000000d;break;}
          this.mem.write32(reference,count-1);
          if(count===1){region.readable=false;region.writable=false;region.executable=false;}
        }
        result=0;break;
      }
      case 'NtQueryInformationFile': {
        const [handle,io,out,length,kind]=args,object=this.handles.get(handle);
        if(object?.kind!=='file'){result=0xc0000008;break;}
        const required={4:40,5:24,14:8,34:56}[kind];
        if(required===undefined)return {handled:false,service,args};
        if(length<required){result=0xc0000023;break;}
        const data=Buffer.alloc(required),size=BigInt(object.size),allocated=BigInt(page(object.size));
        if(kind===34){data.writeBigUInt64LE(allocated,32);data.writeBigUInt64LE(size,40);data.writeUInt32LE(object.directory?16:object.userdata?128:1,48);}
        if(kind===4)data.writeUInt32LE(object.directory?16:object.userdata?128:1,32);
        if(kind===5){data.writeBigUInt64LE(allocated);data.writeBigUInt64LE(size,8);data.writeUInt32LE(1,16);data[21]=object.directory?1:0;}
        if(kind===14)data.writeBigUInt64LE(BigInt(object.position));
        this.mem.writeBytes(out,data);this.mem.write32(io,0);this.mem.write32(io+4,required);result=0;break;
      }
      case 'RtlEqualString': {
        let left=this.string(args[0]),right=this.string(args[1]);
        if(args[2]){
          if(/[^\x00-\x7f]/.test(left+right))throw new Error('Non-ASCII case folding is not implemented');
          left=left.toUpperCase();right=right.toUpperCase();
        }
        result=left===right?1:0;break;
      }
      case 'RtlInitAnsiString': {
        const [out,pointer]=args;let length=0;
        if(pointer)while(length<65534&&this.mem.read(pointer+length,1))length++;
        this.mem.write(out,length,2);this.mem.write(out+2,pointer?length+1:0,2);this.mem.write32(out+4,pointer);break;
      }
      case 'NtQueryVolumeInformationFile': {
        const [handle,io,out,length,kind]=args;
        if(this.handles.get(handle)?.kind!=='file'){result=0xc0000008;break;}
        if(kind!==3)return {handled:false,service,args};
        if(length<24){result=0xc0000023;break;}
        const totalBytes=[...this.fileSystem.files.values()].reduce((sum,file)=>sum+file.size,0);
        const totalUnits=Math.ceil(totalBytes/16384);
        this.mem.write32(out,totalUnits);this.mem.write32(out+4,0);this.mem.write32(out+8,0);this.mem.write32(out+12,0);
        this.mem.write32(out+16,32);this.mem.write32(out+20,512);
        this.mem.write32(io,0);this.mem.write32(io+4,24);result=0;break;
      }
      case 'MmAllocateContiguousMemory':case 'MmAllocateContiguousMemoryEx': {
        const size=page(args[0]);
        if(!size||size>profile.memoryLimitBytes||this.allocated+size>profile.memoryLimitBytes){result=0;break;}
        const alignment=service.name.endsWith('Ex')?(args[3]||4096):4096;
        if(alignment<4096||(alignment&(alignment-1)))throw new Error('Unsupported contiguous alignment');
        const low=service.name.endsWith('Ex')?args[1]:0,high=service.name.endsWith('Ex')?Math.min(args[2],0x3ffffff):0x3ffffff;
        let address=Math.ceil(Math.max(0x80400000,0x80000000+low)/alignment)*alignment;
        for(const [base,block] of [...this.contiguous].sort((a,b)=>a[0]-b[0])){
          if(address+size<=base)break;
          if(address<base+block.size)address=Math.ceil((base+block.size)/alignment)*alignment;
        }
        if((address-0x80000000)+size-1>high){result=0;break;}
        const protect=service.name.endsWith('Ex')?args[4]:4;
        this.mem.map(address,Buffer.alloc(size),{name:'contiguous_allocation',...this.permissions(protect)});
        this.contiguous.set(address,{size,persistent:false,protect});this.nextPhysical=address+size+4096;this.allocated+=size;result=address;break;
      }
      case 'MmFreeContiguousMemory': {
        const allocation=this.contiguous.get(args[0]);if(!allocation)throw new Error('Invalid contiguous free');
        this.mem.regions=this.mem.regions.filter(r=>r.address!==args[0]);this.allocated-=allocation.size;this.contiguous.delete(args[0]);break;
      }
      case 'MmPersistContiguousMemory': {
        const allocation=this.contiguous.get(args[0]);if(!allocation||args[1]>allocation.size)throw new Error('Invalid persistent memory range');
        allocation.persistent=!!args[2];break;
      }
      case 'MmGetPhysicalAddress':
        if(![...this.contiguous].some(([base,a])=>args[0]>=base&&args[0]<base+a.size))return {handled:false,service,args};
        result=args[0]&0x7fffffff;break;
      case 'MmQueryAllocationSize': {
        const region=this.mem.regions.find(r=>args[0]>=r.address&&args[0]<r.end);result=region?region.end-region.address:0;break;
      }
      case 'NtFreeVirtualMemory': {
        const [baseOut,sizeOut,type]=args,base=this.mem.read32(baseOut),size=this.mem.read32(sizeOut);
        const allocation=[...this.virtualAllocations.values()].find(a=>base>=a.base&&base<a.base+a.size);
        if(!allocation){result=0xc000000d;break;}
        if(type===0x8000){
          if(base!==allocation.base||size){result=0xc000000d;break;}
          this.mem.regions=this.mem.regions.filter(r=>r.address!==base);this.virtualAllocations.delete(base);this.allocated-=allocation.size;
          this.mem.write32(baseOut,0);this.mem.write32(sizeOut,0);
        }else if(type===0x4000){
          const start=Math.floor(base/4096)*4096,length=page(size+(base-start));
          if(!size||start+length>allocation.base+allocation.size){result=0xc000000d;break;}
          this.mem.protect(start,length,{readable:false,writable:false,executable:false});
          const region=this.mem.regions.find(r=>r.address===allocation.base);region.bytes.fill(0,start-region.address,start+length-region.address);
          for(let at=start;at<start+length;at+=4096)allocation.committed.delete(at);
          this.mem.write32(baseOut,start);this.mem.write32(sizeOut,length);
        }else return {handled:false,service,args};
        result=0;break;
      }
      case 'NtOpenFile':case 'NtCreateFile': {
        if(!this.fileSystem)return {handled:false,service,args};
        const [out,access,attributes,io]=args;
        const name=this.string(this.mem.read32(attributes+4)),rootHandle=this.mem.read32(attributes);
        const root=rootHandle?this.handles.get(rootHandle):null;
        if(rootHandle&&root?.kind!=='file'){result=0xc0000008;break;}
        const options=service.name==='NtOpenFile'?args[5]:args[8];
        this.mem.region(out,4,'write');this.mem.region(io,8,'write');
        const object=this.fileSystem.open(name,{root,desiredAccess:access,options,disposition:service.name==='NtCreateFile'?args[7]:1});
        this.mem.write32(out,this.newHandle(object));this.mem.write32(io,0);this.mem.write32(io+4,object.created?2:1);result=0;break;
      }
      case 'NtReadFile':case 'NtWriteFile': {
        if(!this.fileSystem)return {handled:false,service,args};
        const [handle,eventHandle,apc,context,io,buffer,length,offsetPointer]=args;
        if(eventHandle||apc||context)return {handled:false,service,args};
        const object=this.handles.get(handle);
        if(object?.kind!=='file'){result=0xc0000008;break;}
        if(length>16*1024*1024)throw new Error('Guest I/O exceeds per-call limit');
        this.mem.region(io,8,'write');if(length)this.mem.region(buffer,length,service.name==='NtReadFile'?'write':'read');
        let offset=null;
        if(offsetPointer){const value=(BigInt(this.mem.read32(offsetPointer+4)|0)<<32n)|BigInt(this.mem.read32(offsetPointer));if(value===-1n&&service.name==='NtWriteFile')offset=object.size;else if(value!==-2n)offset=Number(value);}
        if(service.name==='NtReadFile'){
          const bytes=this.fileSystem.read(object,length,offset);this.mem.writeBytes(buffer,bytes);
          result=length&&!bytes.length?0xc0000011:0;this.mem.write32(io,result);this.mem.write32(io+4,bytes.length);
        }else {const count=this.fileSystem.write(object,this.mem.readBytes(buffer,length),offset);this.mem.write32(io,0);this.mem.write32(io+4,count);result=0;}
        break;
      }
      case 'IoCreateSymbolicLink':
        if(!this.fileSystem)return {handled:false,service,args};
        this.fileSystem.link(this.string(args[0]),this.string(args[1]));result=0;break;
      case 'IoDeleteSymbolicLink':
        if(!this.fileSystem)return {handled:false,service,args};
        result=this.fileSystem.links.delete(this.string(args[0]).toLowerCase().replace(/^\\\?\?\\/,''))?0:0xc0000034;break;
      case 'NtAllocateVirtualMemory': {
        const [baseOut,zeroBits,sizeOut,type,protect]=args;
        if(zeroBits||(type&~0x3000)||!(type&0x3000))return {handled:false,service,args};
        const requested=this.mem.read32(baseOut),requestedSize=this.mem.read32(sizeOut);
        if(!requestedSize){result=0xc000000d;break;}
        const permissions=this.permissions(protect);
        let base=requested?Math.floor(requested/4096)*4096:0,size=page(requestedSize+(requested-base));
        if(type&0x2000){
          if(base)return {handled:false,service,args}; // Fixed-address reservation needs a gap allocator.
          base=this.allocate(size,'virtual_reservation',{readable:false,writable:false});
          this.virtualAllocations.set(base,{base,size,protect,committed:new Set()});
        }
        const allocation=[...this.virtualAllocations.values()].find(a=>base>=a.base&&base+size<=a.base+a.size);
        if(!allocation){result=0xc0000018;break;}
        if(type&0x1000){
          this.mem.protect(base,size,permissions);
          for(let at=base;at<base+size;at+=4096)allocation.committed.add(at);
        }
        this.mem.write32(baseOut,base);this.mem.write32(sizeOut,size);result=0;break;
      }
      case 'RtlNtStatusToDosError':
        result=new Map([[0,0],[0x102,1460],[0xc0000008,6],[0xc000000d,87],[0xc0000017,8],[0xc0000022,5],[0xc0000023,122],[0xc0000034,2],[0xc000003a,3],[0xc0000043,32]]).get(args[0])??317;break;
      case 'KeSetTimer': {
        const [at,low,high,dpc]=args,timer=this.timers.get(at);
        if(!timer)throw new Error('KeSetTimer requires an initialized timer');
        const due=(BigInt(high|0)<<32n)|BigInt(low);
        result=timer.armed?1:0;timer.armed=true;timer.signaled=false;timer.dpc=dpc;
        timer.due=due<0n?this.time-due:due-132223104000000000n;
        this.mem.write32(at+4,0);this.mem.write32(at+16,Number(BigInt.asUintN(32,due)));this.mem.write32(at+20,Number(BigInt.asUintN(32,due>>32n)));this.mem.write32(at+32,dpc);
        break;
      }
      case 'KeCancelTimer': {
        const timer=this.timers.get(args[0]);if(!timer)throw new Error('Unknown timer');result=timer.armed?1:0;timer.armed=false;break;
      }
      case 'ExQueryNonVolatileSetting': {
        const [index,typeOut,valueOut,length,resultLength]=args;
        if(!Object.hasOwn(profile.nonvolatileDwords,String(index)))return {handled:false,service,args};
        if(resultLength)this.mem.write32(resultLength,4);
        if(length<4){result=0xc0000023;break;}
        if(typeOut)this.mem.write32(typeOut,4);
        this.mem.write32(valueOut,profile.nonvolatileDwords[index]);result=0;break;
      }
      case 'HalRegisterShutdownNotification': {
        const [registration,register]=args;
        if(register)this.shutdownNotifications.set(registration,{routine:this.mem.read32(registration),priority:this.mem.read32(registration+4)|0});
        else this.shutdownNotifications.delete(registration);
        break;
      }
      case 'KeInitializeDpc': {
        const [at,routine,context]=args;this.mem.region(at,28,'write');
        this.mem.write(at,19,1);this.mem.write(at+1,0,1);this.mem.write32(at+4,at+4);this.mem.write32(at+8,at+4);
        this.mem.write32(at+12,routine);this.mem.write32(at+16,context);this.mem.write32(at+20,0);this.mem.write32(at+24,0);
        this.dpcs.set(at,{routine,context});break;
      }
      case 'KeInitializeTimerEx': {
        const [at,type]=args;if(type>1)throw new Error('Invalid timer type');this.mem.region(at,40,'write');
        this.mem.write(at,type?9:8,1);this.mem.write(at+2,10,1);this.mem.write32(at+4,0);
        this.mem.write32(at+8,at+8);this.mem.write32(at+12,at+8);
        this.timers.set(at,{type,armed:false,signaled:false});break;
      }
      case 'PsCreateSystemThreadEx': {
        const [out,extensionBytes,stackBytes,tlsBytes,idOut,startRoutine,startContext,suspended,debuggerThread,systemRoutine]=args;
        if(extensionBytes||debuggerThread)throw new Error('Thread extensions/debugger threads are not implemented');
        this.mem.region(out,4,'write');if(idOut)this.mem.region(idOut,4,'write');
        const child=this.createThread({stackBytes,tlsBytes,startRoutine,startContext,systemRoutine,suspended:!!suspended});
        this.mem.write32(out,child.handle);if(idOut)this.mem.write32(idOut,child.id);
        result=0;break;
      }
      case 'NtResumeThread': {
        const object=this.handles.get(args[0]);
        if(object?.kind!=='thread'){result=0xc0000008;break;}
        const child=object.thread;
        if(args[1])this.mem.write32(args[1],child.suspendCount);
        child.suspendCount=Math.max(0,child.suspendCount-1);
        if(child.status==='suspended'&&!child.suspendCount)child.status='ready';
        result=0;break;
      }
      case 'PsTerminateSystemThread':
        thread.status='terminated';thread.exitCode=args[0];this.mem.write32(thread.threadAddress+4,1);event.exitCode=args[0];return {handled:true};
      case 'NtClose':
        if(this.handles.get(args[0])?.kind==='file')this.fileSystem.close(this.handles.get(args[0]));
        result=this.handles.delete(args[0])?0:0xc0000008;break;
      case 'RtlInitializeCriticalSection': {
        const at=args[0];this.mem.region(at,28,'write');
        this.mem.write32(at,0x40001);this.mem.write32(at+4,0);
        this.mem.write32(at+8,at+8);this.mem.write32(at+12,at+8);
        this.mem.write32(at+16,0xffffffff);this.mem.write32(at+20,0);this.mem.write32(at+24,0);
        this.locks.set(at,{owner:0,depth:0});break;
      }
      case 'RtlEnterCriticalSection': {
        const at=args[0];
        const lock=this.locks.get(at)??{owner:this.mem.read32(at+24),depth:this.mem.read32(at+20)};
        if(lock.owner&&lock.owner!==thread.id)throw new Error('Contended critical-section scheduling is not implemented');
        lock.owner=thread.id;lock.depth++;
        this.locks.set(at,lock);this.mem.write32(at+16,lock.depth-1);this.mem.write32(at+20,lock.depth);this.mem.write32(at+24,thread.id);
        break;
      }
      case 'RtlLeaveCriticalSection': {
        const at=args[0],lock=this.locks.get(at);
        if(!lock||lock.owner!==thread.id||!lock.depth)throw new Error('Critical section released by a non-owner');
        lock.depth--;if(!lock.depth)lock.owner=0;
        this.mem.write32(at+16,lock.depth-1);this.mem.write32(at+20,lock.depth);this.mem.write32(at+24,lock.owner);
        break;
      }
      default: return {handled:false,service,args};
    }}catch(error){
      if(!(error instanceof FileStatus))throw error;
      result=error.status;event.fileError=error.message;
      const io=['NtOpenFile','NtCreateFile'].includes(service.name)?args[3]:['NtReadFile','NtWriteFile'].includes(service.name)?args[4]:0;
      if(io){this.mem.write32(io,result);this.mem.write32(io+4,0);}
    }
    this.complete(cpu,service,result);event.result=result;
    return {handled:true};
  }
  permissions(protect) {
    if(protect&~0x7ff)throw new Error('Unsupported memory protection flags');
    const mode=protect&255;
    if(![1,2,4,8,16,32,64,128].includes(mode)||(protect&0x100))throw new Error('Unsupported memory protection');
    return {readable:mode!==1&&mode!==16,writable:[4,8,64,128].includes(mode),executable:[16,32,64,128].includes(mode)};
  }
}
