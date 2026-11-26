import {readdirSync, lstatSync, openSync, readSync, closeSync} from 'node:fs';
import {join, relative} from 'node:path';
import {root} from './game-image.mjs';

// Check the actual directory contents, including ignored files, before sharing
// a source folder or ZIP. A .gitignore does not remove files from an archive.
const privateDirectories = new Set(['local', 'node_modules', 'build', 'native/assets', 'native/generated', 'native/out']);
const forbidden = /\.(iso|xbe|xpr|xmv|bik|wav|ogg|mp3|dds|tga|bin|exe|dll|obj|o|pdb|lib|a|zip|7z|tgz)$/i;
const problems = [];
function walk(directory) {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    const path = join(directory, entry.name), name = relative(root, path).replaceAll('\\', '/');
    if (entry.name === '.git') continue;
    if (privateDirectories.has(name)) { problems.push(`${name}: private output/dependency directory`); continue; }
    if (lstatSync(path).isSymbolicLink()) { problems.push(`${name}: linked content`); continue; }
    if (entry.isDirectory()) { walk(path); continue; }
    if (forbidden.test(entry.name)) { problems.push(`${name}: binary, archive or game asset`); continue; }
    const fd = openSync(path, 'r');
    try {
      const magic = Buffer.alloc(4);
      readSync(fd, magic, 0, 4, 0);
      if (magic.toString('ascii') === 'XBEH') problems.push(`${name}: Xbox executable`);
    } finally { closeSync(fd); }
  }
}
walk(root);
if (problems.length) {
  console.error('Source release check failed:\n' + problems.map(p => `  ${p}`).join('\n'));
  process.exitCode = 1;
} else console.log('Source release check passed: no private directories, linked content or known game/binary files.');
