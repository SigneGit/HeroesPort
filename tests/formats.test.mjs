import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Image } from '../tools/xdvdfs.mjs';
import { inspectXbe } from '../tools/xbe.mjs';

function fixtureXbe() {
  const data = Buffer.alloc(0x500);
  const set = (offset, value) => data.writeUInt32LE(value >>> 0, offset);
  data.write('XBEH');
  set(0x104, 0x10000); set(0x108, 0x400); set(0x10c, 0x2000);
  set(0x118, 0x10180); set(0x11c, 1); set(0x120, 0x10240);
  set(0x128, 0x11000 ^ 0xa8fc57ab); set(0x158, 0x11040 ^ 0x5b6d40b6);
  set(0x180, 0xb0); set(0x188, 0x12345678);
  data.write('Synthetic Test', 0x18c, 'utf16le');
  set(0x240, 4); set(0x244, 0x11000); set(0x248, 0x100);
  set(0x24c, 0x400); set(0x250, 0x80); set(0x254, 0x10280);
  data.write('.text\0', 0x280); data[0x400] = 0xc3;
  set(0x440, 0x80000008); set(0x444, 0);
  return data;
}
function fixtureIso(name = 'default.xbe', content = fixtureXbe()) {
  const data = Buffer.alloc(0x13000);
  data.write('MICROSOFT*XBOX*MEDIA', 0x10000);
  data.writeUInt32LE(0x22, 0x10014); data.writeUInt32LE(64, 0x10018);
  data.write('MICROSOFT*XBOX*MEDIA', 0x107ec);
  const at = 0x11000;
  data.writeUInt32LE(0x24, at + 4); data.writeUInt32LE(content.length, at + 8);
  data[at + 12] = 0x20; data[at + 13] = name.length; data.write(name, at + 14, 'latin1');
  content.copy(data, 0x12000);
  return data;
}
function withImage(bytes, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'heroes-test-'));
  const path = join(directory, 'synthetic.iso');
  writeFileSync(path, bytes);
  let image;
  try { image = new Image(path); return callback(image); }
  finally { image?.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('reads synthetic XISO file and decodes retail entry and kernel ordinal', () => {
  withImage(fixtureIso(), image => {
    const files = image.files();
    assert.equal(files.length, 1);
    assert.deepEqual(files[0], { path: 'default.xbe', offset: 0x12000, size: 0x500 });
    const report = inspectXbe(image.read(files[0].offset, files[0].size));
    assert.equal(report.entryPoint, 0x11000);
    assert.equal(report.title, 'Synthetic Test');
    assert.equal(report.titleId, '0x12345678');
    assert.deepEqual(report.kernelImports, [{ slot: 0x11040, ordinal: 8 }]);
    assert.equal(report.sections[0].fileSize, 0x80);
    assert.equal(report.sections[0].virtualSize, 0x100);
  });
});
test('decodes debug keys independently', () => {
  const data = fixtureXbe();
  data.writeUInt32LE((0x11000 ^ 0x94859d4b) >>> 0, 0x128);
  data.writeUInt32LE((0x11040 ^ 0xefb1f152) >>> 0, 0x158);
  assert.equal(inspectXbe(data).mode, 'debug');
});
test('requires both volume signatures', () => {
  const data = fixtureIso(); data[0x107ec] = 0;
  assert.throws(() => withImage(data, () => {}), /descriptor/);
});
test('rejects truncated disc extents', () => {
  const data = fixtureIso(); data.writeUInt32LE(9999, 0x11004);
  withImage(data, image => assert.throws(() => image.files(), /extent/));
});

test('accepts an allocated erased table as an empty XISO directory', () => {
  const data=fixtureIso('empty');
  data[0x1100c]=0x10;
  data.writeUInt32LE(2048,0x11008);
  data.fill(0xff,0x12000,0x12800);
  withImage(data,image=>assert.deepEqual(image.files(),[]));
  // An erased child pointer in a nonempty table must still be rejected.
  data[0x12000]=0;
  withImage(data,image=>assert.throws(()=>image.files()));
});
for (const name of ['../escape', 'a\\b', 'file:stream', 'NUL.txt', 'bad.', 'bad ', '..']) {
  test(`rejects unsafe disc path ${JSON.stringify(name)}`, () => {
    withImage(fixtureIso(name), image => assert.throws(() => image.files(), /Unsafe/));
  });
}
test('rejects cyclic directory trees', () => {
  const data = fixtureIso(); data.writeUInt16LE(4, 0x11000);
  data.writeUInt16LE(4, 0x11010);
  withImage(data, image => assert.throws(() => image.files()));
});
test('rejects recursive directory extents', () => {
  const data = fixtureIso('folder');
  data.writeUInt32LE(0x22, 0x11004); data.writeUInt32LE(64, 0x11008); data[0x1100c] = 0x10;
  withImage(data, image => assert.throws(() => image.files(), /cycle/));
});
test('rejects out of range XBE pointers', () => {
  const data = fixtureXbe(); data.writeUInt32LE(0xffffffff, 0x120);
  assert.throws(() => inspectXbe(data), /headers/);
});
test('rejects XBE raw section overflow', () => {
  const data = fixtureXbe(); data.writeUInt32LE(0x10000, 0x250);
  assert.throws(() => inspectXbe(data), /outside/);
});
test('rejects invalid encoded entry', () => {
  const data = fixtureXbe(); data.writeUInt32LE(0, 0x128);
  assert.throws(() => inspectXbe(data), /entry point/);
});
test('rejects nonordinal kernel thunk', () => {
  const data = fixtureXbe(); data.writeUInt32LE(8, 0x440);
  assert.throws(() => inspectXbe(data), /ordinal/);
});
test('rejects virtual image overflow', () => {
  const data = fixtureXbe(); data.writeUInt32LE(0xfffffff0, 0x244);
  assert.throws(() => inspectXbe(data), /section bounds/);
});
