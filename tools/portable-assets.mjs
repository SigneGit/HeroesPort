import {openSync,closeSync,readSync,writeSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,renameSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {copyFileSync,readdirSync} from 'node:fs';
import {Image} from './xdvdfs.mjs';
import {inspectXbe} from './xbe.mjs';
import {selectBuild} from './supported-builds.mjs';

export const manifestName='.heroes-import.json';
const renameWait=new Int32Array(new SharedArrayBuffer(4));
export function commitImport(stage,directory,{rename=renameSync,wait=ms=>Atomics.wait(renameWait,0,0,ms)}={}) {
  // Windows scanners/indexers may briefly hold a freshly written file without
  // FILE_SHARE_DELETE. Keep the verified staging tree private until its rename
  // succeeds, and never replace an import created by another preparation.
  for(let attempt=0;;attempt++) {
    if(lstatSync(directory,{throwIfNoEntry:false}))
      throw Error('The assets destination already exists. Existing files were retained.');
    try {rename(stage,directory);return;}
    catch(error) {
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===10)throw error;
      wait(Math.min(50*2**attempt,1000));
    }
  }
}
export function hashFile(filename) {
  const hash=createHash('sha256'),block=Buffer.alloc(1024*1024),fd=openSync(filename,'r');
  try {let n;while((n=readSync(fd,block,0,block.length,null)))hash.update(block.subarray(0,n));}
  finally {closeSync(fd);}
  return hash.digest('hex');
}
function supported(image,profile) {
  const files=image.files(),entry=files.find(f=>f.path.toLowerCase()==='default.xbe');
  if(!entry||entry.size>128*1024*1024)throw Error('Missing or oversized default.xbe.');
  const report=inspectXbe(image.read(entry.offset,entry.size));
  profile=selectBuild(profile,report.sha256,report.titleId);
  return {files,report,profile};
}
function verifyInventory(files,profile) {
  const inventory=files.map(file=>[file.path.toLowerCase(),file.size,file.sha256]);
  inventory.sort(([a],[b])=>a<b?-1:a>b?1:0);
  if(createHash('sha256').update(JSON.stringify(inventory)).digest('hex')!==profile.extractedTreeSha256)
    throw Error('Game files must match the complete, unmodified supported game.');
}
export function validateAssets(directory,profile) {
  if(lstatSync(directory).isSymbolicLink())throw Error('The release assets directory must not be a link.');
  const manifest=JSON.parse(readFileSync(join(directory,manifestName),'utf8'));
  profile=selectBuild(profile,manifest.executableSha256);
  if(manifest.executableSha256!==profile.xbeSha256||!Array.isArray(manifest.files)||!manifest.files.length)
    throw Error('Imported game manifest does not match the supported game.');
  const seen=new Set();let executable=false;
  for(const file of manifest.files) {
    if(typeof file.path!=='string'||file.path.includes('\\')||isAbsolute(file.path)||file.path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe path in import manifest.');
    const target=resolve(directory,file.path),rel=relative(resolve(directory),target);
    if(rel.startsWith('..')||isAbsolute(rel))throw Error('Import path escapes assets directory.');
    const key=file.path.toLowerCase();if(seen.has(key))throw Error('Duplicate path in import manifest.');seen.add(key);
    for(let part=target;part!==resolve(directory);part=dirname(part))
      if(lstatSync(part).isSymbolicLink())throw Error('Imported files must not contain links.');
    if(!lstatSync(target).isFile()||lstatSync(target).size!==file.size||hashFile(target)!==file.sha256)
      throw Error(`Imported file is missing or damaged: ${file.path}. Existing files were retained.`);
    if(key==='default.xbe') {executable=true;if(file.sha256!==profile.xbeSha256)throw Error('Unsupported imported executable.');}
  }
  if(!executable)throw Error('The import manifest has no executable.');
  verifyInventory(manifest.files,profile);
  return manifest.files.length;
}
export function importAssets(iso,directory,profile) {
  if(lstatSync(iso).isDirectory())return importFolder(resolve(iso),directory,profile);
  const image=new Image(resolve(iso));
  try {
    // Always verify a selected ISO, including when reusing an existing import.
    const selected=supported(image,profile);
    const {files,report}=selected;profile=selected.profile;
    const reuse=existsSync(directory);
    const parent=dirname(resolve(directory));mkdirSync(parent,{recursive:true});
    if(lstatSync(parent).isSymbolicLink())throw Error('The release folder must not be a link.');
    const stage=reuse?null:mkdtempSync(join(parent,'.heroes-extract-'));
    try {
      const manifest=[];
      for(const entry of files) {
        if(entry.path.toLowerCase()===manifestName)throw Error('Reserved import metadata filename.');
        let fd;
        if(stage) {
          const target=join(stage,...entry.path.split('/'));
          mkdirSync(dirname(target),{recursive:true});
          fd=openSync(target,'wx');
        }
        const hash=createHash('sha256');
        try {
          for(let done=0;done<entry.size;) {
            const bytes=image.read(entry.offset+done,Math.min(1024*1024,entry.size-done));hash.update(bytes);
            if(fd!==undefined) {
              for(let offset=0;offset<bytes.length;)offset+=writeSync(fd,bytes,offset,bytes.length-offset);
            }
            done+=bytes.length;
          }
        } finally {if(fd!==undefined)closeSync(fd);}
        manifest.push({path:entry.path,size:entry.size,sha256:hash.digest('hex')});
      }
      verifyInventory(manifest,profile);
      if(reuse)return validateAssets(directory,profile);
      writeFileSync(join(stage,manifestName),JSON.stringify({schemaVersion:1,build:profile.name,executableSha256:report.sha256,files:manifest},null,2)+'\n',{flag:'wx'});
      commitImport(stage,directory);
      return manifest.length;
    } catch(error) {if(stage)rmSync(stage,{recursive:true,force:true});throw error;}
  } finally {image.close();}
}

function importFolder(source,directory,profile) {
  const executable=join(source,'default.xbe');
  if(!existsSync(executable)||!lstatSync(executable).isFile())
    throw Error('Select the extracted Xbox game folder containing default.xbe.');
  const report=inspectXbe(readFileSync(executable));
  profile=selectBuild(profile,report.sha256,report.titleId);
  const files=[];
  function scan(path,prefix) {
    for(const entry of readdirSync(path,{withFileTypes:true})) {
      const name=prefix+entry.name,file=join(path,entry.name);
      if(entry.isDirectory())scan(file,name+'/');
      else if(!entry.isFile())throw Error('Extracted game folders must contain only regular files and directories.');
      else if(name.toLowerCase()!==manifestName)files.push({path:name,size:lstatSync(file).size,sha256:hashFile(file)});
    }
  }
  scan(source,'');
  verifyInventory(files,profile);
  if(existsSync(directory))return validateAssets(directory,profile);
  const stage=mkdtempSync(join(dirname(directory),'.heroes-extract-'));
  try {
    for(const file of files) {
      const target=join(stage,file.path);
      mkdirSync(dirname(target),{recursive:true});
      copyFileSync(join(source,file.path),target);
    }
    writeFileSync(join(stage,manifestName),JSON.stringify({schemaVersion:1,build:profile.name,executableSha256:profile.xbeSha256,files}));
    validateAssets(stage,profile);
    commitImport(stage,directory);
    return files.length;
  } catch(error) {rmSync(stage,{recursive:true,force:true});throw error;}
}
