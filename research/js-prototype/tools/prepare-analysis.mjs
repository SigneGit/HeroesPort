import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectXbe, hex } from '../../../tools/xbe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  const profile = JSON.parse(readFileSync(join(root, 'config/supported-build.json'), 'utf8'));
  const xbe = readFileSync(join(root, 'local/game/assets/default.xbe'));
  const report = inspectXbe(xbe);
  if (report.sha256 !== profile.xbeSha256) throw new Error('Imported executable fingerprint mismatch');
  if (report.imageSize > 128 * 1024 * 1024) throw new Error('Mapped image exceeds safety limit');
  const destination = join(root, 'local/analysis');
  if (existsSync(destination)) throw new Error('local/analysis already exists; move it aside before regenerating');
  const mapped = Buffer.alloc(report.imageSize);
  xbe.copy(mapped, 0, 0, report.headersSize);
  for (const section of report.sections) xbe.copy(mapped, section.address - report.baseAddress, section.fileOffset, section.fileOffset + section.fileSize);
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'memory.bin'), mapped, { flag: 'wx' });
  writeFileSync(join(destination, 'layout.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`Prepared ${mapped.length} bytes at guest base ${hex(report.baseAddress)}.`);
  console.log(`Import ${join(destination, 'memory.bin')} into Ghidra as Raw Binary, x86:LE:32:default, base ${hex(report.baseAddress)}.`);
  console.log(`Before analysis run HeroesSetup.java with argument ${join(destination, 'layout.json')}.`);
} catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
