import { createHash } from 'node:crypto';
export const hex = value => `0x${value.toString(16).padStart(8, '0')}`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function inspectXbe(data) {
  function range(offset, size) {
    if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > data.length) throw new Error('XBE structure outside file');
    return offset;
  }
  const u32 = at => data.readUInt32LE(range(at, 4));
  if (data.length < 0x178 || data.toString('ascii', 0, 4) !== 'XBEH') throw new Error('Invalid XBE header');
  const base = u32(0x104), headersSize = u32(0x108), imageSize = u32(0x10c);
  if (headersSize < 0x178 || headersSize > data.length || headersSize > imageSize || base + imageSize > 0x100000000) throw new Error('Invalid XBE image bounds');
  const headerOffset = (va, size) => {
    const at = va - base;
    if (at < 0 || at + size > headersSize) throw new Error('XBE header address outside headers');
    return range(at, size);
  };
  const count = u32(0x11c);
  if (count === 0 || count > 4096) throw new Error('Invalid XBE section count');
  const sectionTable = headerOffset(u32(0x120), count * 56);
  const sections = [];
  for (let index = 0; index < count; index++) {
    const at = sectionTable + index * 56;
    const flags = u32(at), address = u32(at + 4), virtualSize = u32(at + 8), fileOffset = u32(at + 12), fileSize = u32(at + 16);
    range(fileOffset, fileSize);
    if (address < base + headersSize || address + virtualSize > base + imageSize || fileSize > virtualSize) throw new Error('Invalid XBE section bounds');
    const nameAt = headerOffset(u32(at + 20), 1);
    const end = data.indexOf(0, nameAt);
    if (end < 0 || end >= headersSize || end - nameAt > 256) throw new Error('Invalid section name');
    const name = data.toString('ascii', nameAt, end);
    sections.push({ name, flags, address, virtualSize, fileOffset, fileSize, executable: !!(flags & 4), writable: !!(flags & 1), sha256: sha256(data.subarray(fileOffset, fileOffset + fileSize)) });
  }
  function fileOffset(va, length = 4) {
    if (va >= base && va + length <= base + headersSize) return headerOffset(va, length);
    const section = sections.find(s => va >= s.address && va + length <= s.address + s.fileSize);
    if (!section) throw new Error(`Unbacked XBE address: ${hex(va)}`);
    return range(section.fileOffset + va - section.address, length);
  }
  const encodedEntry = u32(0x128), encodedThunk = u32(0x158);
  const modes = [{ name: 'retail', entryKey: 0xa8fc57ab, thunkKey: 0x5b6d40b6 }, { name: 'debug', entryKey: 0x94859d4b, thunkKey: 0xefb1f152 }];
  const mode = modes.find(m => {
    const entry = (encodedEntry ^ m.entryKey) >>> 0;
    return sections.some(s => s.executable && entry >= s.address && entry < s.address + s.fileSize);
  });
  if (!mode) throw new Error('No supported retail/debug entry point in executable section');
  const entryPoint = (encodedEntry ^ mode.entryKey) >>> 0, kernelThunkAddress = (encodedThunk ^ mode.thunkKey) >>> 0;
  const kernelImports = [];
  if (kernelThunkAddress) {
    let terminated = false;
    for (let i = 0; i < 4096; i++) {
      const value = u32(fileOffset(kernelThunkAddress + i * 4));
      if (value === 0) { terminated = true; break; }
      if (!(value & 0x80000000)) throw new Error('Invalid kernel ordinal thunk');
      kernelImports.push({ slot: kernelThunkAddress + i * 4, ordinal: value & 0x7fffffff });
    }
    if (!terminated) throw new Error('Unterminated kernel thunk table');
  }
  const certificate = headerOffset(u32(0x118), 0xb0);
  const titleId = u32(certificate + 8), title = data.toString('utf16le', certificate + 12, certificate + 92).replace(/\0.*$/s, '');
  const libraryCount = u32(0x160), libraries = [];
  if (libraryCount > 4096) throw new Error('Invalid library count');
  if (libraryCount) {
    const start = headerOffset(u32(0x164), libraryCount * 16);
    for (let i = 0; i < libraryCount; i++) {
      const at = start + i * 16;
      libraries.push({ name: data.toString('ascii', at, at + 8).replace(/\0.*$/s, ''), major: data.readUInt16LE(at + 8), minor: data.readUInt16LE(at + 10), build: data.readUInt16LE(at + 12), flags: data.readUInt16LE(at + 14) });
    }
  }
  return { sha256: sha256(data), title, titleId: hex(titleId), mode: mode.name, baseAddress: base, headersSize, imageSize, entryPoint, kernelThunkAddress, tlsAddress: u32(0x12c), libraries, sections, kernelImports };
}
