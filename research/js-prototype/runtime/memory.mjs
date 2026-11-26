import { hex } from '../../../tools/xbe.mjs';

export class GuestMemory {
  constructor() { this.regions = []; this.writes = []; this.codeBytes = new Set(); }
  protectTranslatedCode(ranges) {
    for (const [address, size] of ranges) for (let at = address; at < address + size; at++) this.codeBytes.add(at);
  }
  map(address, bytes, { name = 'memory', readable = true, writable = false, executable = false } = {}) {
    if (!Number.isSafeInteger(address) || address < 0 || !bytes.length || address + bytes.length > 0x100000000) throw new Error('Invalid guest mapping');
    if (this.regions.some(r => address < r.end && address + bytes.length > r.address)) throw new Error('Overlapping guest mapping');
    this.regions.push({ address, end: address + bytes.length, bytes: Buffer.from(bytes), name, readable, writable, executable, pages:new Map() });
  }
  protect(address,size,permissions) {
    const region=this.regions.find(r=>address>=r.address&&address+size<=r.end);
    if(!region||address%4096||size%4096)throw new Error('Invalid guest page protection range');
    for(let at=address;at<address+size;at+=4096)region.pages.set(at,{...permissions});
  }
  region(address, size, access = 'read') {
    if (!Number.isInteger(address) || !Number.isSafeInteger(size) || size < 0 || address < 0 || address + size > 0x100000000) throw new Error(`Invalid guest address ${address}`);
    const region = this.regions.find(r => address >= r.address && address + size <= r.end);
    const permits=permission=>access==='write'?permission.writable:access==='execute'?permission.executable:permission.readable;
    let allowed=!!region;
    if(region)for(let at=Math.floor(address/4096)*4096;at<address+size;at+=4096)if(!permits(region.pages.get(at)??region))allowed=false;
    if (!allowed)
      throw new Error(`Guest ${access} fault at ${hex(address)} (${size} bytes)`);
    return region;
  }
  read(address, size) {
    if (![1,2,4].includes(size)) throw new Error('Unsupported guest read size');
    const region = this.region(address, size);
    return region.bytes.readUIntLE(address - region.address, size);
  }
  write(address, value, size) {
    if (![1,2,4].includes(size)) throw new Error('Unsupported guest write size');
    const region = this.region(address, size, 'write');
    for (let at = address; at < address + size; at++) if (this.codeBytes.has(at)) throw new Error(`Self-modifying translated code at ${hex(address)} is unsupported`);
    value = size === 4 ? value >>> 0 : value & (2 ** (size * 8) - 1);
    region.bytes.writeUIntLE(value, address - region.address, size);
    this.writes.push({ address, value, size });
  }
  read32(address) { return this.read(address,4); }
  write32(address,value) { this.write(address,value,4); }
  readBytes(address,size) { const r=this.region(address,size);return Buffer.from(r.bytes.subarray(address-r.address,address-r.address+size)); }
  writeBytes(address,bytes) {
    if(!bytes.length)return;
    const r=this.region(address,bytes.length,'write');
    for(let at=address;at<address+bytes.length;at++)if(this.codeBytes.has(at))throw new Error('Self-modifying translated code is unsupported');
    Buffer.from(bytes).copy(r.bytes,address-r.address);this.writes.push({address,size:bytes.length,bulk:true});
  }
}
