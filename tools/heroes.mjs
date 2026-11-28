import { openSync, closeSync, writeSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Image } from './xdvdfs.mjs';
import { inspectXbe, hex } from './xbe.mjs';
import {selectBuild} from './supported-builds.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, filename, ...extra] = process.argv.slice(2);
function json(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function copyExtent(image, entry, destination) {
  const fd = openSync(destination, 'wx');
  const hash = createHash('sha256');
  try {
    for (let done = 0; done < entry.size;) {
      const bytes = image.read(entry.offset + done, Math.min(1024 * 1024, entry.size - done));
      hash.update(bytes);
      let written = 0;
      while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
      done += bytes.length;
    }
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

try {
  if (!['inspect', 'import'].includes(command) || !filename || extra.length)
    throw new Error('Usage: node tools/heroes.mjs <inspect|import> "path/to/game.iso"');
  const image = new Image(resolve(filename));
  try {
    const files = image.files();
    const executable = files.find(file => file.path.toLowerCase() === 'default.xbe');
    if (!executable) throw new Error('Image has no root default.xbe');
    if (executable.size > 128 * 1024 * 1024) throw new Error('Executable exceeds analysis limit');
    const xbe = image.read(executable.offset, executable.size);
    const report = inspectXbe(xbe);
    const summary = {
      ...report, isoSize: image.size, partitionOffset: image.base,
      fileCount: files.length, assetBytes: files.reduce((sum, file) => sum + file.size, 0),
    };
    if (command === 'inspect') { console.log(JSON.stringify(summary, null, 2)); }
    else {
      const profilePath = join(root, 'config', 'supported-build.json');
      if (!existsSync(profilePath)) throw new Error('No supported executable profile configured');
      const profile = selectBuild(JSON.parse(readFileSync(profilePath, 'utf8')),report.sha256,report.titleId);
      // A fresh private staging directory prevents overwrite and symlink traversal.
      const local = join(root, 'local'), destination = join(local, 'game');
      mkdirSync(local, { recursive: true });
      const { lstatSync } = await import('node:fs');
      if (lstatSync(local).isSymbolicLink()) throw new Error('local must not be a symbolic link');
      if (existsSync(destination)) throw new Error('local/game already exists; move it aside to import again');
      const staging = join(local, `import-${process.pid}-${Date.now()}`);
      mkdirSync(staging);
      try {
        const manifest = [];
        for (const entry of files) {
          const target = join(staging, 'assets', ...entry.path.split('/'));
          mkdirSync(dirname(target), { recursive: true });
          manifest.push({ path: entry.path, size: entry.size, sha256: copyExtent(image, entry, target) });
        }
        json(join(staging, 'manifest.json'), { schemaVersion: 1, build: profile.name, executableSha256: report.sha256, files: manifest });
        json(join(staging, 'analysis.json'), summary);
        renameSync(staging, destination);
        console.log(`Imported ${files.length} files to ${destination}`);
        console.log(`Entry point: ${hex(report.entryPoint)}; ${report.kernelImports.length} kernel imports.`);
        console.log('Import complete. Next: node tools/prepare-native.mjs (native migration is still in development).');
      } catch (error) {
        // Only remove the exact fresh directory created by this invocation.
        rmSync(staging, { recursive: true, force: true });
        throw error;
      }
    }
  } finally { image.close(); }
} catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
