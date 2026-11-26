import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectXbe } from './xbe.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function loadGame() {
  const profile = JSON.parse(readFileSync(join(root, 'config/supported-build.json'), 'utf8'));
  const xbe = readFileSync(join(root, 'local/game/assets/default.xbe'));
  const layout = inspectXbe(xbe);
  if (layout.sha256 !== profile.xbeSha256 || layout.titleId !== profile.titleId) throw new Error('Executable fingerprint mismatch');
  if (layout.imageSize > 128 * 1024 * 1024) throw new Error('Image exceeds safety limit');
  const memory = Buffer.alloc(layout.imageSize);
  xbe.copy(memory, 0, 0, layout.headersSize);
  for (const section of layout.sections) xbe.copy(memory, section.address - layout.baseAddress, section.fileOffset, section.fileOffset + section.fileSize);
  return { memory, layout };
}
