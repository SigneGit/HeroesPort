import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, loadGame } from '../../../tools/game-image.mjs';
import { createSession,runSession } from '../runtime/session.mjs';
import { GuestFileSystem } from '../runtime/filesystem.mjs';

try {
  const args=process.argv.slice(2);
  let limit=1000000;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--stop-before-kernel')continue;
    if(args[i]==='--steps'&&/^\d+$/.test(args[i+1]??'')){limit=Number(args[++i]);continue;}
    throw new Error('Usage: node research/js-prototype/tools/probe-startup.mjs [--stop-before-kernel] [--steps count]');
  }
  if(limit<1||limit>2000000)throw new Error('Instruction limit must be between 1 and 2000000');
  const {memory,layout}=loadGame();
  const module=await import(pathToFileURL(join(root,'local/recompiled/startup.mjs')).href);
  const fileSystem=new GuestFileSystem({assetsRoot:join(root,'local/game/assets'),files:JSON.parse(readFileSync(join(root,'local/game/manifest.json'))).files,userDataRoot:join(root,'local/userdata')});
  let result;
  try{const session=createSession(memory,layout,module,{fileSystem});result=runSession(session,{limit,stopBeforeKernel:args.includes('--stop-before-kernel')});}
  finally{fileSystem.dispose();}
  const output=join(root,'local/recompiled/startup-trace.json');
  mkdirSync(join(root,'local/recompiled'),{recursive:true});
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  if(result.stop.kind==='untranslated-target'){
    const target=Number(result.stop.address);
    if(layout.sections.some(s=>s.executable&&target>=s.address&&target<s.address+s.fileSize)){
      const savedPath=join(root,'local/recompiled/discovered-targets.json');
      const saved=existsSync(savedPath)?JSON.parse(readFileSync(savedPath)):{fingerprint:layout.sha256,targets:[]};
      if(saved.fingerprint!==layout.sha256)throw new Error('Discovered target fingerprint mismatch');
      saved.targets=[...new Set([...saved.targets,target])].sort((a,b)=>a-b);
      writeFileSync(savedPath,JSON.stringify(saved,null,2)+'\n');
      console.log(`Recorded indirect target ${result.stop.address}; rerun analyze-startup to translate it.`);
    }
  }
  console.log(JSON.stringify({executedInstructions:result.executedInstructions,stop:result.stop,threads:result.threads.length,finalState:result.finalState},null,2));
  console.log(`Diagnostic trace: ${output}`);
  process.exitCode=result.stop.kind==='all-threads-terminated'?0:2;
}catch(error){console.error(`Error: ${error.message}`);process.exitCode=1;}
