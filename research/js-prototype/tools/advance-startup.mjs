// Resolve observed indirect targets in bounded, ahead-of-execution translation passes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../../tools/game-image.mjs';

try {
  let previous='';
  for(let pass=1;pass<=12;pass++){
    const analysis=spawnSync(process.execPath,[join(root,'research/js-prototype/tools/analyze-startup.mjs')],{cwd:root,encoding:'utf8'});
    if(analysis.status!==0)throw new Error(analysis.stderr||analysis.stdout);
    const probe=spawnSync(process.execPath,[join(root,'research/js-prototype/tools/probe-startup.mjs')],{cwd:root,encoding:'utf8'});
    if(![0,2].includes(probe.status))throw new Error(probe.stderr||probe.stdout);
    const result=JSON.parse(readFileSync(join(root,'local/recompiled/startup-trace.json')));
    console.log(`Pass ${pass}: ${result.executedInstructions} instructions; ${JSON.stringify(result.stop)}`);
    const key=JSON.stringify(result.stop);
    if(result.stop.kind!=='untranslated-target'||key===previous){process.exitCode=probe.status;break;}
    previous=key;
    if(pass===12){console.log('Translation pass limit reached. Run again to continue recorded target discovery.');process.exitCode=2;}
  }
}catch(error){console.error(error.message);process.exitCode=1;}
