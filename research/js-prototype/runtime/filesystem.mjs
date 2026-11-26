import { openSync, closeSync, readSync, writeSync, realpathSync, lstatSync, existsSync, mkdirSync, mkdtempSync, fstatSync, ftruncateSync } from 'node:fs';
import { resolve, relative, sep, join, dirname } from 'node:path';

export class FileStatus extends Error {
  constructor(status,message) {super(message);this.status=status;}
}
const NOT_FOUND=0xc0000034,ACCESS_DENIED=0xc0000022;
export class GuestFileSystem {
  constructor({assetsRoot,files,userDataRoot=null}) {
    this.root=realpathSync(assetsRoot);this.files=new Map();this.directories=new Set(['']);
    this.mount='\\device\\harddisk0\\partition1\\heroes';
    this.userMount='\\device\\harddisk0\\partition1';
    if(userDataRoot){
      let ancestor=resolve(userDataRoot);while(!existsSync(ancestor))ancestor=dirname(ancestor);
      const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
      if(normalize(realpathSync(ancestor))!==normalize(ancestor))throw new Error('User data root cannot traverse a link');
      mkdirSync(userDataRoot,{recursive:true});if(lstatSync(userDataRoot).isSymbolicLink())throw new Error('User data root cannot be a link');this.userRoot=realpathSync(userDataRoot);
    }
    this.links=new Map([['d:',this.mount]]);this.opened=new Set();this.events=[];
    for(const file of files){
      const key=file.path.replaceAll('\\','/').toLowerCase();
      if(key.startsWith('/')||key.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':')))throw new Error('Unsafe asset manifest path');
      this.files.set(key,file);
      const parts=key.split('/');while(parts.length>1){parts.pop();this.directories.add(parts.join('/'));}
    }
  }
  link(name,target) {this.links.set(name.toLowerCase().replace(/^\\\?\?\\/,''),target.toLowerCase());}
  mountUtility(formatClean) {
    if(!this.userRoot)throw new Error('Utility storage needs a user data mount');
    const cache=this.safeTarget(this.userRoot,'cache');mkdirSync(cache,{recursive:true});
    const directory=formatClean?mkdtempSync(join(cache,'clean-')):this.safeTarget(this.userRoot,'cache/current');
    mkdirSync(directory,{recursive:true});
    this.utilityKey=relative(this.userRoot,directory).split(sep).join('/');
    this.links.set('z:','\\device\\heroesutility');
    this.events.push({kind:'mount-utility',formatClean:!!formatClean,path:'Z:',directory:this.utilityKey});
  }
  canonical(path,root=null) {
    if(path.includes('\0'))throw new FileStatus(ACCESS_DENIED,'NUL in guest path');
    let value=path.replaceAll('/','\\').toLowerCase();
    if(root&&!value.startsWith('\\')&&!/^[a-z]:/.test(value))value=root.guestPath+'\\'+value;
    value=value.replace(/^\\\?\?\\/,'');
    value=value.replace(/\\+$/,'');
    for(let n=0;n<16;n++){
      const link=[...this.links].sort((a,b)=>b[0].length-a[0].length).find(([name])=>value===name||value.startsWith(name+'\\'));
      if(!link)break;
      value=link[1]+value.slice(link[0].length);
      if(n===15)throw new FileStatus(ACCESS_DENIED,'Guest link cycle');
    }
    const utility='\\device\\heroesutility';
    if(this.utilityKey&&(value===utility||value.startsWith(utility+'\\'))){
      const tail=value.slice(utility.length).split('\\').filter(Boolean).join('/');this.validateComponents(tail);
      return {key:this.utilityKey+(tail?'/'+tail:''),guestPath:value,userdata:true};
    }
    const prefix=value==='\\device\\cdrom0'||value.startsWith('\\device\\cdrom0\\')?'\\device\\cdrom0':this.mount;
    if(this.userRoot&&(value===this.userMount||value.startsWith(this.userMount+'\\'))&&!(value===this.mount||value.startsWith(this.mount+'\\'))){
      const key=value.slice(this.userMount.length).split('\\').filter(Boolean).join('/');
      this.validateComponents(key);return {key,guestPath:value,userdata:true};
    }
    if(this.mount.startsWith(value+'\\'))return {key:null,guestPath:value,namespace:true};
    if(value!==prefix&&!value.startsWith(prefix+'\\'))throw new FileStatus(NOT_FOUND,`Unmapped guest device ${value}`);
    const components=value.slice(prefix.length).split('\\').filter(Boolean);
    this.validateComponents(components.join('/'));
    return {key:components.join('/'),guestPath:prefix+(components.length?'\\'+components.join('\\'):'')};
  }
  validateComponents(key) {
    if(key&&key.split('/').some(part=>!part||part==='..'||part==='.'||/[<>:"\\|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new FileStatus(ACCESS_DENIED,'Unsafe guest path');
  }
  safeTarget(root,key) {
    this.validateComponents(key);
    const target=resolve(root,...key.split('/').filter(Boolean)),pathRelative=relative(root,target);
    if(pathRelative==='..'||pathRelative.startsWith('..'+sep))throw new FileStatus(ACCESS_DENIED,'Guest path escaped mount');
    let component=root;
    for(const part of pathRelative.split(sep).filter(Boolean)){component=join(component,part);if(existsSync(component)&&lstatSync(component).isSymbolicLink())throw new FileStatus(ACCESS_DENIED,'Guest path links are not allowed');}
    return target;
  }
  openUser(normalized,{desiredAccess,options,disposition}) {
    if(![0,1,2,3,4,5].includes(disposition))throw new FileStatus(0xc000000d,'Invalid create disposition');
    if(options&0x1000)throw new Error('Delete-on-close is not implemented');
    const target=this.safeTarget(this.userRoot,normalized.key),exists=existsSync(target),writable=!!(desiredAccess&(0x40000000|0x10000000|2|4));
    if([0,4,5].includes(disposition)&&!writable)throw new FileStatus(ACCESS_DENIED,'Overwrite requires write access');
    if(!exists&&[1,4].includes(disposition))throw new FileStatus(NOT_FOUND,'User file not found');
    if(exists&&disposition===2)throw new FileStatus(0xc0000035,'User file exists');
    if(!exists){
      try{if(options&1)mkdirSync(target);else {const fd=openSync(target,'wx');closeSync(fd);}}
      catch(error){if(error.code==='ENOENT')throw new FileStatus(0xc000003a,'Parent directory not found');throw error;}
    }
    const directory=lstatSync(target).isDirectory();
    if(directory&&![1,3].includes(disposition))throw new FileStatus(0xc00000ba,'Cannot overwrite a directory');
    if((options&1)&&!directory)throw new FileStatus(0xc0000103,'Not a directory');
    if((options&0x40)&&directory)throw new FileStatus(0xc00000ba,'File is a directory');
    const object={kind:'file',directory,guestPath:normalized.guestPath,key:normalized.key,position:0,writable,size:directory?0:lstatSync(target).size,userdata:true,created:!exists};
    if(!directory){object.fd=openSync(target,writable?'r+':'r');this.opened.add(object);if([0,4,5].includes(disposition)){if(!writable)throw new FileStatus(ACCESS_DENIED,'Overwrite requires write access');ftruncateSync(object.fd,0);object.size=0;}}
    this.events.push({kind:exists?'open':'create',path:normalized.guestPath,directory,size:object.size,mount:'userdata'});return object;
  }
  open(path,{root=null,desiredAccess=0,options=0,disposition=1}={}) {
    const normalized=this.canonical(path,root);
    if(normalized.userdata)return this.openUser(normalized,{desiredAccess,options,disposition});
    if(desiredAccess&(0x40000000|0x10000000|2|4|0x10000))throw new FileStatus(ACCESS_DENIED,'Disc assets are read-only');
    if(![1,3].includes(disposition))throw new FileStatus(ACCESS_DENIED,'Imported assets are read-only');
    const file=this.files.get(normalized.key);
    const directory=!!normalized.namespace||this.directories.has(normalized.key);
    if(!file&&!directory)throw new FileStatus(NOT_FOUND,'Asset not found');
    if((options&1)&&!directory)throw new FileStatus(0xc0000103,'Not a directory');
    if((options&0x40)&&directory)throw new FileStatus(0xc00000ba,'File is a directory');
    const object={kind:'file',directory,guestPath:normalized.guestPath,key:normalized.key,position:0,size:file?.size??0};
    if(file){
      const target=resolve(this.root,...file.path.replaceAll('\\','/').split('/'));
      const pathRelative=relative(this.root,target);
      if(pathRelative.startsWith('..'+sep)||pathRelative==='..'||resolve(target)===this.root)throw new FileStatus(ACCESS_DENIED,'Asset escaped root');
      let component=this.root;
      for(const part of pathRelative.split(sep)){component=join(component,part);if(lstatSync(component).isSymbolicLink())throw new FileStatus(ACCESS_DENIED,'Asset symlinks are not allowed');}
      if(realpathSync(target)!==target)throw new FileStatus(ACCESS_DENIED,'Asset path is redirected');
      object.fd=openSync(target,'r');this.opened.add(object);
    }
    this.events.push({kind:'open',path:normalized.guestPath,directory,size:object.size});return object;
  }
  read(object,length,offset=null) {
    if(object.directory)throw new FileStatus(0xc00000ba,'Cannot read a directory');
    if(length>16*1024*1024)throw new Error('Guest read exceeds per-call limit');
    const position=offset??object.position;
    if(!Number.isSafeInteger(position)||position<0)throw new FileStatus(0xc000000d,'Invalid file offset');
    const buffer=Buffer.alloc(Math.min(length,Math.max(0,object.size-position)));
    const count=buffer.length?readSync(object.fd,buffer,0,buffer.length,position):0;
    object.position=position+count;this.events.push({kind:'read',path:object.guestPath,offset:position,size:count});
    return buffer.subarray(0,count);
  }
  write(object,bytes,offset=null) {
    if(!object.userdata||!object.writable||object.directory)throw new FileStatus(ACCESS_DENIED,'File is not writable');
    const position=offset??object.position;
    if(!Number.isSafeInteger(position)||position<0||position+bytes.length>64*1024*1024)throw new FileStatus(0xc000007f,'User file size limit exceeded');
    let count=0;while(count<bytes.length)count+=writeSync(object.fd,bytes,count,bytes.length-count,position+count);
    object.position=position+count;object.size=fstatSync(object.fd).size;
    this.events.push({kind:'write',path:object.guestPath,offset:position,size:count});return count;
  }
  close(object) {if(this.opened.delete(object))closeSync(object.fd);}
  dispose() {for(const object of [...this.opened])this.close(object);}
}
