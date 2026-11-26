import { openSync, closeSync, readSync, fstatSync } from 'node:fs';

const SECTOR = 2048;
const MAGIC = Buffer.from('MICROSOFT*XBOX*MEDIA');
export class Image {
  constructor(filename) {
    this.fd = openSync(filename, 'r');
    this.size = fstatSync(this.fd).size;
    try {
      // Trimmed XISO, redump-style full disc, and older video-partition dumps.
      this.base = [0, 0xfd90000, 0x2080000].find(base => {
        if (base + 0x10800 > this.size) return false;
        const descriptor = this.read(base + 0x10000, SECTOR);
        return descriptor.subarray(0, 20).equals(MAGIC) && descriptor.subarray(2028).equals(MAGIC);
      });
      if (this.base === undefined) throw new Error('No supported XDVDFS volume descriptor found');
      const descriptor = this.read(this.base + 0x10000, SECTOR);
      this.rootSector = descriptor.readUInt32LE(20);
      this.rootSize = descriptor.readUInt32LE(24);
    } catch (error) { this.close(); throw error; }
  }
  close() { if (this.fd !== undefined) { closeSync(this.fd); this.fd = undefined; } }
  read(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.size)
      throw new Error(`Read outside image: ${offset}+${length}`);
    const result = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const count = readSync(this.fd, result, done, length - done, offset + done);
      if (!count) throw new Error('Unexpected end of image');
      done += count;
    }
    return result;
  }
  offset(sector, size) {
    const offset = this.base + sector * SECTOR;
    if (offset + size > this.size) throw new Error('File extent exceeds image');
    return offset;
  }
  files() {
    const files = [], directories = [{ sector: this.rootSector, size: this.rootSize, path: '', depth: 0 }];
    const seenDirectories = new Set(), paths = new Set();
    while (directories.length) {
      const dir = directories.pop();
      if (dir.depth > 64) throw new Error('Directory nesting limit exceeded');
      const identity = `${dir.sector}:${dir.size}`;
      if (seenDirectories.has(identity)) throw new Error('Directory cycle or aliased directory');
      seenDirectories.add(identity);
      if (dir.size === 0) continue;
      if (dir.size > 32 * 1024 * 1024) throw new Error('Directory table exceeds safety limit');
      const table = this.read(this.offset(dir.sector, dir.size), dir.size);
      const pending = [0], visited = new Set();
      while (pending.length) {
        const at = pending.pop();
        if (visited.has(at)) throw new Error('Directory entry cycle');
        visited.add(at);
        if (at + 14 > table.length) throw new Error('Truncated directory entry');
        const left = table.readUInt16LE(at) * 4, right = table.readUInt16LE(at + 2) * 4;
        const sector = table.readUInt32LE(at + 4), size = table.readUInt32LE(at + 8);
        const flags = table[at + 12], length = table[at + 13];
        if (!length || at + 14 + length > table.length) throw new Error('Invalid directory filename length');
        const name = table.toString('latin1', at + 14, at + 14 + length);
        // One portable path component only; reject Windows device names and alternate streams.
        if (/[\x00-\x1f\x7f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
          throw new Error(`Unsafe image filename: ${JSON.stringify(name)}`);
        const path = dir.path ? `${dir.path}/${name}` : name;
        const key = path.toLowerCase();
        if (paths.has(key)) throw new Error(`Duplicate image path: ${path}`);
        paths.add(key);
        if (paths.size > 1000000) throw new Error('Image entry count exceeds safety limit');
        const offset = this.offset(sector, size);
        if (flags & 0x10) directories.push({ sector, size, path, depth: dir.depth + 1 });
        else files.push({ path, offset, size });
        if (right) pending.push(right);
        if (left) pending.push(left);
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  }
}
