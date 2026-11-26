// Restricted x87 backend for normal binary64 startup math. Extended precision,
// unsupported exceptional values and subnormal arithmetic stop explicitly.
export class Fpu {
  constructor(){this.control=0x37f;this.status=0;this.stack=[];this.top=0;}
  sync(){this.status=(this.status&~0x3800)|(this.top<<11);}
  get(index=0){if(index>=this.stack.length)throw new Error('x87 stack underflow');return this.stack[index];}
  set(index,value){this.get(index);this.stack[index]=value;}
  push(value){if(this.stack.length===8)throw new Error('x87 stack overflow');if(!Number.isFinite(value))throw new Error('Non-finite x87 load is not implemented');this.stack.unshift(value);this.top=(this.top+7)&7;this.sync();}
  pop(){const value=this.get();this.stack.shift();this.top=(this.top+1)&7;this.sync();return value;}
  exchange(index=1){const value=this.get();this.set(0,this.get(index));this.set(index,value);}
  load(memory,address,size,integer=false){
    const bytes=memory.readBytes(address,size);let value;
    if(integer){const exact=size===8?bytes.readBigInt64LE():BigInt(bytes.readIntLE(0,size));value=Number(exact);if(BigInt(value)!==exact)throw new Error('x87 integer load requires extended precision');}
    else value=size===4?bytes.readFloatLE():bytes.readDoubleLE();
    this.push(value);
  }
  round(value){
    const mode=(this.control>>>10)&3;
    if(mode===1)return Math.floor(value);if(mode===2)return Math.ceil(value);if(mode===3)return Math.trunc(value);
    const low=Math.floor(value),fraction=value-low;
    return fraction<0.5?low:fraction>0.5?low+1:low%2===0?low:low+1;
  }
  store(memory,address,size,{integer=false,pop=false,truncate=false}={}){
    const value=this.get(),bytes=Buffer.alloc(size);
    if(integer){
      const rounded=truncate?Math.trunc(value):this.round(value),bits=size*8;
      let exact=BigInt(rounded);
      if(exact<-(1n<<BigInt(bits-1))||exact>=(1n<<BigInt(bits-1))){this.status|=1;if(!(this.control&1))throw new Error('Unmasked x87 invalid conversion');exact=-(1n<<BigInt(bits-1));}
      if(rounded!==value)this.status|=32;
      if(size===8)bytes.writeBigInt64LE(exact);else bytes.writeIntLE(Number(exact),0,size);
    }else{
      if(((this.control>>>10)&3)!==0)throw new Error('Directed x87 floating-point stores are not implemented');
      if(size===4)bytes.writeFloatLE(value);else bytes.writeDoubleLE(value);
    }
    memory.writeBytes(address,bytes);if(pop)this.pop();
  }
  binary(kind,a,b){
    if(((this.control>>>8)&3)!==2||((this.control>>>10)&3)!==0)throw new Error('x87 arithmetic currently requires binary64 precision and nearest rounding');
    const value=kind==='add'?a+b:kind==='sub'?a-b:kind==='mul'?a*b:a/b;
    if(!Number.isFinite(value)||(value!==0&&Math.abs(value)<2**-1022)||(value===0&&a!==0&&b!==0&&['mul','div'].includes(kind)))throw new Error('x87 exceptional/extended-range arithmetic is not implemented');
    const exact=x=>{
      const bytes=Buffer.alloc(8);bytes.writeDoubleLE(x);const bits=bytes.readBigUInt64LE(),exponent=Number((bits>>52n)&2047n);
      let numerator=(bits&((1n<<52n)-1n))|(exponent?1n<<52n:0n);if(bits>>63n)numerator=-numerator;
      const power=(exponent?exponent-1023:-1022)-52;
      return power>=0?{n:numerator<<BigInt(power),d:1n}:{n:numerator,d:1n<<BigInt(-power)};
    };
    const x=exact(a),y=exact(b),rounded=exact(value);
    let numerator,denominator;
    if(kind==='mul'){numerator=x.n*y.n;denominator=x.d*y.d;}
    else if(kind==='div'){numerator=x.n*y.d;denominator=x.d*y.n;}
    else {numerator=x.n*y.d+(kind==='sub'?-1n:1n)*y.n*x.d;denominator=x.d*y.d;}
    if(numerator*rounded.d!==rounded.n*denominator){this.status|=32;if(!(this.control&32))throw new Error('Unmasked x87 precision exception');}
    return value;
  }
  compare(a,b){this.status&=~0x4500;if(a<b)this.status|=0x100;else if(a===b)this.status|=0x4000;}
}
