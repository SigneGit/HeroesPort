import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {root} from './game-image.mjs';
import {validateLauncherImport} from './launcher-import.mjs';

function runCommand(executable, args, cwd) {
  const result = spawnSync(executable, args, {cwd, stdio:'inherit', windowsHide:true});
  if (result.error || result.status !== 0)
    throw Error(result.error?.message ?? `Preparation step failed (${result.status}): ${args[0]}`);
}

export function prepareLauncherGame({projectRoot=root, iso, run=runCommand, validate=validateLauncherImport}={}) {
  const output = join(projectRoot, 'native/out/build/release');
  const ready = join(output, 'heroes-ready.json');
  // Never leave a previous success marker after a failed or interrupted setup.
  rmSync(ready, {force:true});
  if (iso) run(process.execPath, [join(projectRoot, 'tools/launcher-import.mjs'), iso], projectRoot);
  const count = validate(join(projectRoot, 'local/game'));
  console.log(`Verified ${count} imported files. Preparing the game; the first build may take several minutes...`);
  for (const script of ['setup-native-deps.mjs', 'build-native-tools.mjs'])
    run(process.execPath, [join(projectRoot, 'tools', script)], projectRoot);
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'tools/build-native.ps1'), '-GameOnly'], projectRoot);
  for (const name of ['Heroes.exe', 'Heroes.dll'])
    if (!existsSync(join(output, name))) throw Error(`Preparation did not produce ${name}. Play remains unavailable.`);
  mkdirSync(output, {recursive:true});
  writeFileSync(ready, JSON.stringify({schemaVersion:1, importedFiles:count})+'\n');
  console.log('Ready to play. Choose your settings and press Play.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
    const [argument, ...extra] = process.argv.slice(2);
    if (!argument || extra.length) throw Error('Select an ISO or use --existing to prepare an imported game.');
    prepareLauncherGame({iso:argument === '--existing' ? undefined : argument});
  } catch (error) { console.error(`Game preparation failed: ${error.message}`); process.exitCode=1; }
}
