// Explicit maintenance command: snapshot public CC0 ABI facts, never game data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from '../../../tools/game-image.mjs';

async function get(url, json = false) {
  const response = await fetch(url, {headers:{'User-Agent':'heroes-pc-research'},signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return json ? response.json() : response.text();
}
try {
  const commit = (await get('https://api.github.com/repos/XboxDev/nxdk/commits/master',true)).sha;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid source revision');
  const source = `https://raw.githubusercontent.com/XboxDev/nxdk/${commit}/lib/xboxkrnl/`;
  const exports = await get(source+'xboxkrnl.exe.def');
  const header = await get(source+'xboxkrnl.h');
  if (!exports.includes('SPDX-License-Identifier: CC0-1.0') || !header.includes('SPDX-License-Identifier: CC0-1.0')) throw new Error('Unexpected source license');
  const services = [];
  for (const line of exports.split(/\r?\n/)) {
    const match = line.match(/^\s*(\S+)\s+@\s*(\d+)\s+NONAME(?:\s+(DATA))?\s*$/);
    if (!match) continue;
    const [,symbol,ordinal,data] = match;
    const bytes = symbol.match(/@(\d+)$/);
    services.push({ordinal:Number(ordinal),name:symbol.replace(/^@/,'').replace(/@\d+$/,''),kind:data?'data':'function',convention:data?null:symbol.startsWith('@')?'fastcall':bytes?'stdcall':'cdecl',argumentBytes:bytes?Number(bytes[1]):null});
  }
  if (services.length < 360 || services.find(s=>s.ordinal===255)?.name !== 'PsCreateSystemThreadEx') throw new Error('Unexpected kernel export layout');
  const reference = join(root,'local/reference'); mkdirSync(reference,{recursive:true});
  writeFileSync(join(reference,'xboxkrnl.h'),header);
  writeFileSync(join(reference,'xboxkrnl.exe.def'),exports);
  const metadata = {source:source+'xboxkrnl.exe.def',revision:commit,license:'CC0-1.0',attribution:'XboxDev/nxdk; export table copyright 2017 Stefan Schmidt',sha256:createHash('sha256').update(exports).digest('hex'),services};
  writeFileSync(join(root,'config/kernel-abi.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log(`Recorded ${services.length} public kernel ABI entries at revision ${commit}.`);
} catch(error) {console.error(error.message);process.exitCode=1;}
