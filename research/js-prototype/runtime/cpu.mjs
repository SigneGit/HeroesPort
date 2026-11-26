// Narrow, explicit semantics for the startup translation proof. Not a full x86 CPU.
import { hex } from '../../../tools/xbe.mjs';
import { Fpu } from './fpu.mjs';
export const CF = 1, PF = 4, AF = 16, ZF = 64, SF = 128, OF = 2048;
const ARITH = CF | PF | AF | ZF | SF | OF;
export class Cpu {
  constructor(memory) { this.mem = memory; this.r = new Uint32Array(8); this.flags = 0x202; this.known = 0; this.pc = 0; this.fsBase = 0; this.fpu=new Fpu();this.mxcsr=0x1f80; }
  resetFpu(){this.fpu=new Fpu();}
  waitFpu() {if(this.fpu.status&~this.fpu.control&63)throw new Error('Pending unmasked x87 exception');}
  setResultFlags(value, width = 32) {
    let parity = value & 255;
    parity ^= parity >>> 4; parity ^= parity >>> 2; parity ^= parity >>> 1;
    this.flags = (this.flags & ~(ZF | SF | PF)) | (value === 0 ? ZF : 0) | (value >= 2 ** (width - 1) ? SF : 0) | (!(parity & 1) ? PF : 0);
  }
  arithmetic(kind, a, b, width = 32) {
    const mod = 2 ** width, sign = mod / 2;
    a = (a >>> 0) % mod; b = (b >>> 0) % mod;
    const subtract = kind === 'sub' || kind === 'sbb';
    const carryIn = kind === 'adc' || kind === 'sbb' ? this.carry() : 0;
    const full = subtract ? a - b - carryIn : a + b + carryIn;
    const value = ((full % mod) + mod) % mod;
    const carry = subtract ? full < 0 : full >= mod;
    const signedA = a >= sign ? a-mod : a, signedB = b >= sign ? b-mod : b;
    const signedFull = subtract ? signedA-signedB-carryIn : signedA+signedB+carryIn;
    const overflow = signedFull < -sign || signedFull >= sign;
    this.flags = (this.flags & ~(CF | AF | OF)) | (carry ? CF : 0) | ((a ^ b ^ value) & 16) | (overflow ? OF : 0);
    this.setResultFlags(value,width); this.known = ARITH;
    return value;
  }
  carry() { if (!(this.known & CF)) throw new Error('Undefined carry flag'); return this.flags & CF; }
  increment(value, delta, width=32) {
    const cf = this.flags & CF, knownCf = this.known & CF;
    const result = this.arithmetic(delta>0?'add':'sub',value,Math.abs(delta),width);
    this.flags = (this.flags & ~CF) | cf; this.known = (this.known & ~CF) | knownCf;
    return result;
  }
  logic(kind, a, b, width=32) {
    const value = ((kind === 'and' ? a & b : kind === 'or' ? a | b : a ^ b) >>> 0) % 2 ** width;
    this.flags &= ~(CF | OF); this.setResultFlags(value,width); this.known = ARITH & ~AF;
    return value;
  }
  shr(value, count) {
    return this.shift('shr',value,count,32);
  }
  shift(kind,value,count,width=32) {
    count&=31;const mod=2**width,sign=mod/2;value=(value>>>0)%mod;
    if(!count)return value;
    let result,carry;
    if(kind==='shl'){result=Number((BigInt(value)<<BigInt(count))&BigInt(mod-1));carry=count<=width?Math.floor(value/2**(width-count))&1:0;}
    else {
      const signed=value>=sign?value-mod:value;
      result=kind==='sar'?((Math.floor(signed/2**count)%mod)+mod)%mod:Math.floor(value/2**count);
      carry=count<=width?Math.floor(value/2**(count-1))&1:kind==='sar'&&value>=sign?1:0;
    }
    const overflow=kind==='shl'?((result>=sign?1:0)^carry):kind==='shr'&&value>=sign?1:0;
    this.flags=(this.flags&~(CF|OF))|carry|(count===1&&overflow?OF:0);
    this.setResultFlags(result,width);
    this.known=PF|ZF|SF|(count<width||kind==='sar'?CF:0)|(count===1?OF:0);
    return result;
  }
  multiply(value,signed=false,other=null) {
    const a=BigInt(signed?(other??this.r[0])|0:(other??this.r[0])>>>0);
    const b=BigInt(signed?value|0:value>>>0),full=a*b;
    const low=Number(BigInt.asUintN(32,full));
    if(other===null){this.r[0]=low;this.r[2]=Number(BigInt.asUintN(32,full>>32n));}
    const overflow=signed?full < -2147483648n||full>2147483647n:full>0xffffffffn;
    this.flags=(this.flags&~(CF|OF))|(overflow?CF|OF:0);this.known=CF|OF;
    return low;
  }
  divide(divisor) {
    divisor>>>=0;if(!divisor)throw new Error('Guest divide error: zero divisor');
    const dividend=(BigInt(this.r[2])<<32n)|BigInt(this.r[0]),quotient=dividend/BigInt(divisor);
    if(quotient>0xffffffffn)throw new Error('Guest divide error: quotient overflow');
    this.r[0]=Number(quotient);this.r[2]=Number(dividend%BigInt(divisor));this.known=0;
  }
  string(kind,size,repeat) {
    const count = repeat ? this.r[1] : 1;
    if (count > 1048576) throw new Error('String operation exceeds diagnostic limit');
    const stride = this.flags & 0x400 ? -size : size;
    for (let n=0;n<count;n++) {
      if (kind === 'movs') { this.mem.write(this.r[7],this.mem.read(this.r[6],size),size); this.r[6]=(this.r[6]+stride)>>>0; }
      else this.mem.write(this.r[7],this.r[0],size);
      this.r[7]=(this.r[7]+stride)>>>0;
      if (repeat) this.r[1]--;
    }
  }
  condition(name) {
    const need = { Jo:OF,Jno:OF,Jp:PF,Jnp:PF,Jae: CF, Jb: CF, Je: ZF, Jne: ZF, Jbe: CF | ZF, Ja: CF | ZF, Js: SF, Jns: SF, Jge: SF | OF, Jl: SF | OF, Jg: ZF | SF | OF, Jle: ZF | SF | OF }[name];
    if (need === undefined || (this.known & need) !== need) throw new Error(`Undefined or unsupported condition ${name} at ${hex(this.pc)}`);
    const cf = !!(this.flags & CF), zf = !!(this.flags & ZF), sf = !!(this.flags & SF), of = !!(this.flags & OF);
    return { Jo:of,Jno:!of,Jp:!!(this.flags&PF),Jnp:!(this.flags&PF),Jae: !cf, Jb: cf, Je: zf, Jne: !zf, Jbe: cf || zf, Ja: !cf && !zf, Js: sf, Jns: !sf, Jge: sf === of, Jl: sf !== of, Jg: !zf && sf === of, Jle: zf || sf !== of }[name];
  }
  push(value) { const address = (this.r[4] - 4) >>> 0; this.mem.write32(address, value); this.r[4] = address; }
  pop() { const value = this.mem.read32(this.r[4]); this.r[4] = (this.r[4] + 4) >>> 0; return value; }
  idiv(divisor) {
    divisor |= 0;
    if (!divisor) throw new Error('Guest divide error: zero divisor');
    const dividend = (BigInt(this.r[2] | 0) << 32n) | BigInt(this.r[0]);
    const quotient = dividend / BigInt(divisor), remainder = dividend % BigInt(divisor);
    if (quotient < -2147483648n || quotient > 2147483647n) throw new Error('Guest divide error: quotient overflow');
    this.r[0] = Number(BigInt.asUintN(32, quotient)); this.r[2] = Number(BigInt.asUintN(32, remainder)); this.known = 0;
  }
  unsupported(description) { throw new Error(`Unsupported x86 at ${hex(this.pc)}: ${description}`); }
  snapshot() { return { pc: hex(this.pc), registers: Object.fromEntries(['eax','ecx','edx','ebx','esp','ebp','esi','edi'].map((name, i) => [name, hex(this.r[i])])), flags: hex(this.flags), knownFlags: hex(this.known),fsBase:hex(this.fsBase),fpu:{control:this.fpu.control,status:this.fpu.status,stack:[...this.fpu.stack]} }; }
}
