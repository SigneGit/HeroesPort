import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './game-image.mjs';
import { fileURLToPath } from 'node:url';

export function vendorSdk(source) {
  const destination=join(root,'third_party/xboxdecomp');
  if(existsSync(destination))throw new Error('SDK snapshot already exists; validate its manifest before updating');
  const files=[];
  const walk=(directory,prefix)=>{
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      const relative=prefix?`${prefix}/${entry.name}`:entry.name,path=join(directory,entry.name);
      if(lstatSync(path).isSymbolicLink())throw new Error('SDK symlinks are not supported');
      if(entry.isDirectory())walk(path,relative);else if(entry.isFile())files.push(relative);
    }
  };
  for(const directory of ['runtime','tools','cmake','xdk','templates'])walk(join(source,directory),directory);
  files.push('LICENSE','THIRD_PARTY.txt','README.md','SDK_VERSION');files.sort();
  const manifest=[];
  for(const relative of files){
    const bytes=readFileSync(join(source,relative)),target=join(destination,relative);
    mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});
    manifest.push({path:relative,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  writeFileSync(join(root,'third_party/xboxdecomp.provenance.json'),JSON.stringify({schemaVersion:1,origin:'User-supplied XboxDecomp source snapshot',license:'MIT; see xboxdecomp/LICENSE and THIRD_PARTY.txt',snapshotSha256:digest,files:manifest},null,2)+'\n',{flag:'wx'});
  console.log(`Vendored ${manifest.length} SDK files, snapshot ${digest}. Original directory is unchanged.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==3)throw new Error('Usage: node tools/vendor-xboxdecomp.mjs path/to/XboxDecomp');vendorSdk(resolve(process.argv[2]));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
