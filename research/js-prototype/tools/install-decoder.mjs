// Fallback for machines with Node but no npm. Normal installations can use npm ci.
import { readFileSync, mkdirSync, writeFileSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  const dependency = JSON.parse(readFileSync(join(root, 'package-lock.json'))).packages['node_modules/iced-x86'];
  const modules = join(root, 'node_modules'), destination = join(modules, 'iced-x86');
  if (existsSync(destination)) throw new Error('iced-x86 already exists; use npm ci to reinstall');
  console.log(`Downloading iced-x86 ${dependency.version} (MIT), with pinned SHA-512 verification.`);
  const response = await fetch(dependency.resolved, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (integrity !== dependency.integrity) throw new Error('Dependency integrity mismatch');
  mkdirSync(modules, { recursive: true });
  const staging = mkdtempSync(join(modules, '.iced-install-'));
  try {
    const archive = join(staging, 'package.tgz');
    writeFileSync(archive, bytes, { flag: 'wx' });
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', staging], { encoding: 'utf8' });
    if (unpack.error) throw unpack.error;
    if (unpack.status !== 0) throw new Error(`tar failed: ${unpack.stderr}`);
    const metadata = JSON.parse(readFileSync(join(staging, 'package/package.json')));
    if (metadata.name !== 'iced-x86' || metadata.version !== dependency.version) throw new Error('Dependency metadata mismatch');
    renameSync(join(staging, 'package'), destination);
  } finally { rmSync(staging, { recursive: true, force: true }); }
  console.log('Decoder installed. No package lifecycle scripts were run.');
} catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
