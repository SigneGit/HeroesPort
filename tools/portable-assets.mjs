import {openSync,closeSync,readSync,writeSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,renameSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {copyFileSync,readdirSync} from 'node:fs';
import {Image} from './xdvdfs.mjs';
import {inspectXbe} from './xbe.mjs';

export const manifestName='.heroes-import.json';
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
  if(report.sha256!==profile.xbeSha256||report.titleId!==profile.titleId)
    throw Error('Unsupported ISO executable. The supported USA game is required.');
  return {files,report};
}
export function validateAssets(directory,profile) {
  if(lstatSync(directory).isSymbolicLink())throw Error('The release assets directory must not be a link.');
  const manifest=JSON.parse(readFileSync(join(directory,manifestName),'utf8'));
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
  return manifest.files.length;
}
export function importAssets(iso,directory,profile) {
  if(lstatSync(iso).isDirectory())return importFolder(resolve(iso),directory,profile);
  const image=new Image(resolve(iso));
  try {
    // Always verify a selected ISO, including when reusing an existing import.
    const {files,report}=supported(image,profile);
    if(existsSync(directory))return validateAssets(directory,profile);
    const parent=dirname(resolve(directory));mkdirSync(parent,{recursive:true});
    if(lstatSync(parent).isSymbolicLink())throw Error('The release folder must not be a link.');
    const stage=mkdtempSync(join(parent,'.heroes-extract-'));
    try {
      const manifest=[];
      for(const entry of files) {
        if(entry.path.toLowerCase()===manifestName)throw Error('Reserved import metadata filename.');
        const target=join(stage,...entry.path.split('/'));mkdirSync(dirname(target),{recursive:true});
        const fd=openSync(target,'wx'),hash=createHash('sha256');
        try {
          for(let done=0;done<entry.size;) {
            const bytes=image.read(entry.offset+done,Math.min(1024*1024,entry.size-done));hash.update(bytes);
            for(let offset=0;offset<bytes.length;)offset+=writeSync(fd,bytes,offset,bytes.length-offset);
            done+=bytes.length;
          }
        } finally {closeSync(fd);}
        manifest.push({path:entry.path,size:entry.size,sha256:hash.digest('hex')});
      }
      writeFileSync(join(stage,manifestName),JSON.stringify({schemaVersion:1,build:profile.name,executableSha256:report.sha256,files:manifest},null,2)+'\n',{flag:'wx'});
      renameSync(stage,directory);
      return manifest.length;
    } catch(error) {rmSync(stage,{recursive:true,force:true});throw error;}
  } finally {image.close();}
}

function importFolder(source,directory,profile) {
  const executable=join(source,'default.xbe');
  if(!existsSync(executable)||!lstatSync(executable).isFile()||hashFile(executable)!==profile.xbeSha256)
    throw Error('Select the extracted USA Xbox game folder containing the supported default.xbe.');
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
  const inventory=files.map(file=>[file.path.toLowerCase(),file.size,file.sha256]);
  inventory.sort(([a],[b])=>a<b?-1:a>b?1:0);
  if(createHash('sha256').update(JSON.stringify(inventory)).digest('hex')!==profile.extractedTreeSha256)
    throw Error('The extracted folder must contain the complete, unmodified supported USA game.');
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
    renameSync(stage,directory);
    return files.length;
  } catch(error) {rmSync(stage,{recursive:true,force:true});throw error;}
}
