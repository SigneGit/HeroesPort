import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from './game-image.mjs';
import {prepareNative} from './prepare-native.mjs';

try{
  prepareNative();
  const run=spawnSync(join(root,'local/native-tools/xbe_recomp.exe'),[
    join(root,'native/config/heroes.toml'),join(root,'local/game/assets/default.xbe'),join(root,'native/generated/heroes'),'--xdk',join(root,'third_party/xboxdecomp/xdk'),
  ],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  const log=run.stdout+run.stderr;writeFileSync(join(root,'local/native-analysis/recompile.log'),log);
  if(run.error||run.status!==0)throw new Error(run.error?.message??log);
  const total=log.match(/total: (\d+) functions, (\d+) instructions, (\d+) code bytes of (\d+), (\d+) jump tables, (\d+) callback entries/);
  const overlaps=Number(log.match(/overlapping decodes: (\d+)/)?.[1]??0);
  const unsupported=Object.fromEntries([...log.matchAll(/^unimplemented (\w+) (\d+)$/gm)].map(match=>[match[1],Number(match[2])]));
  const profile=JSON.parse(readFileSync(join(root,'local/native-analysis/profile-summary.json')));
  const report={...profile,functions:total?Number(total[1]):null,instructions:total?Number(total[2]):null,jumpTables:total?Number(total[5]):null,overlappingDecodes:overlaps,unsupportedForms:unsupported,status:'C++ generated; native compilation/boot and mapping validation are separate checks'};
  writeFileSync(join(root,'local/native-analysis/recompile-summary.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
