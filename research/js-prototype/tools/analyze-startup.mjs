import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, loadGame } from '../../../tools/game-image.mjs';
import { discover } from './decode.mjs';
import { lift, emitModule } from './lift.mjs';
import { hex } from '../../../tools/xbe.mjs';

try {
  const { memory, layout } = loadGame();
  console.log(`Following direct control flow from ${hex(layout.entryPoint)}...`);
  const profile=JSON.parse(readFileSync(join(root,'config/supported-build.json')));
  const targetsPath=join(root,'local/recompiled/discovered-targets.json');
  let targets=[];
  if(existsSync(targetsPath)){
    const saved=JSON.parse(readFileSync(targetsPath));
    if(saved.fingerprint!==layout.sha256)throw new Error('Discovered target fingerprint mismatch');
    targets=saved.targets;
    if(!Array.isArray(targets)||targets.length>10000||targets.some(at=>!Number.isInteger(at)||!layout.sections.some(s=>s.executable&&at>=s.address&&at<s.address+s.fileSize)))throw new Error('Invalid discovered code target');
  }
  const tableTargets=[];
  for(const table of profile.analysisPointerTables??[]){
    const start=Number(table.start),end=Number(table.end);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start%4||end%4||end<start||end-start>65536)throw new Error('Invalid initializer pointer table');
    for(let at=start;at<end;at+=4){
      const target=memory.readUInt32LE(at-layout.baseAddress);
      if(target===0||target===0xffffffff)continue;
      if(!layout.sections.some(s=>s.executable&&target>=s.address&&target<s.address+s.fileSize))throw new Error('Initializer points outside executable sections');
      tableTargets.push(target);
    }
  }
  const graph = discover(memory, layout,{seeds:[layout.entryPoint,...(profile.analysisSeeds??[]).map(Number),...tableTargets,...targets]});
  const unsupported = {}, indirect = [];
  let supported = 0;
  const thunks = new Map(layout.kernelImports.map(i => [i.slot, i.ordinal]));
  for (const instruction of graph.instructions) {
    const result = lift(instruction);
    if (result.supported) supported++;
    else unsupported[instruction.code] = (unsupported[instruction.code] ?? 0) + 1;
    if (['IndirectCall', 'IndirectBranch'].includes(instruction.flow)) {
      const op = instruction.operands[0];
      const ordinal = op?.kind === 'mem' && op.base === 'None' && op.index === 'None' ? thunks.get(op.displacement) : undefined;
      indirect.push({ address: hex(instruction.address), assembly: instruction.assembly, ...(ordinal === undefined ? {} : { kernelOrdinal: ordinal }) });
    }
  }
  const output = join(root, 'local/recompiled');
  mkdirSync(output, { recursive: true });
  const summary = {
    fingerprint: layout.sha256, entry: hex(layout.entryPoint),
    instructionCount: graph.instructions.length, directCallTargetCandidates: graph.functionCandidates.length,
    supportedInstructionCount: supported, unsupportedInstructionCount: graph.instructions.length - supported,
    unresolvedIndirectTransfers: indirect.length, overlappingDecodes: graph.conflicts.length,
    note: 'Direct reachability inventory only. Function pointers, thread callbacks and exception handlers are not exhaustively discovered. Counts do not measure gameplay readiness.',
    outsideSectionTargets: graph.outside.map(hex), unsupportedForms: unsupported, indirect,
  };
  // Outputs are reproducible private build artifacts, intentionally regenerated in place.
  writeFileSync(join(output, 'inventory.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(join(output, 'control-flow.json'), JSON.stringify(graph) + '\n');
  writeFileSync(join(output, 'startup.mjs'), emitModule(graph.instructions, layout.sha256));
  console.log(JSON.stringify({ instructions: summary.instructionCount, functionCandidates: summary.directCallTargetCandidates, supportedInstructions: supported, unsupported: summary.unsupportedInstructionCount, indirectTransfers: indirect.length, overlappingDecodes: graph.conflicts.length }, null, 2));
  console.log(`Private analysis and translated JavaScript: ${output}`);
} catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
