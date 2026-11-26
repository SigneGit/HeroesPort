// Emits JavaScript operations ahead of execution. The generated module never decodes x86.
// Explicit integer instruction forms only; unsupported forms remain diagnostic traps.
const registers = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI'];
function register(name) {
  let index = registers.indexOf(name);
  if (index >= 0) return {index,width:32,shift:0};
  index = ['AX','CX','DX','BX','SP','BP','SI','DI'].indexOf(name);
  if (index >= 0) return {index,width:16,shift:0};
  index = ['AL','CL','DL','BL','AH','CH','DH','BH'].indexOf(name);
  if (index >= 0) return {index:index%4,width:8,shift:index>=4?8:0};
  throw new Error(`unsupported register ${name}`);
}
function reg(name) {
  const {index,width,shift}=register(name);
  return width===32?`s.r[${index}]`:`((s.r[${index}]>>>${shift})&${2**width-1})`;
}
function address(operand,segment=true) {
  for (const name of [operand.base,operand.index]) if(name!=='None' && register(name).width!==32) throw new Error('16-bit addressing');
  if (!['DS','SS','ES','CS','FS'].includes(operand.segment)) throw new Error(`unsupported segment ${operand.segment}`);
  const fs=segment&&operand.segment==='FS'?'s.fsBase+':'';
  return `((${fs}${operand.base === 'None' ? '0' : reg(operand.base)}+${operand.index === 'None' ? '0' : `${reg(operand.index)}*${operand.scale}`}+${operand.displacement})>>>0)`;
}
function width(operand) {
  if(operand.kind==='reg') return register(operand.name).width;
  if(operand.kind==='mem'&&[1,2,4].includes(operand.size)) return operand.size*8;
  throw new Error('unsupported operand width');
}
function read(operand) {
  if (!operand) throw new Error('missing operand');
  if (operand.kind === 'reg') return reg(operand.name);
  if (operand.kind === 'imm' || operand.kind === 'branch') return String(operand.value);
  if (operand.kind === 'mem' && [1,2,4].includes(operand.size)) return `s.mem.read(${address(operand)},${operand.size})`;
  throw new Error('unsupported operand width or type');
}
function write(operand, value) {
  if (operand.kind === 'reg') {
    const {index,width,shift}=register(operand.name);
    if(width===32)return `s.r[${index}]=${value};`;
    return `s.r[${index}]=(s.r[${index}]&${~((2**width-1)<<shift)})|((${value}&${2**width-1})<<${shift});`;
  }
  if (operand.kind === 'mem' && [1,2,4].includes(operand.size)) return `s.mem.write(${address(operand)},${value},${operand.size});`;
  throw new Error('unsupported destination width or type');
}
const binaries = new Set(['Add', 'Sub', 'Adc','Sbb','And', 'Or', 'Xor', 'Cmp', 'Test']);
const conditional = new Set(['Jae', 'Jb', 'Je', 'Jne', 'Ja', 'Jbe', 'Js', 'Jns', 'Jge', 'Jl', 'Jg', 'Jle','Jo','Jno','Jp','Jnp']);
export function lift(instruction) {
  const i = instruction, [a, b] = i.operands, next = `return ${i.next};`;
  try {
    const string = {'Movsb_m8_m8':['movs',1],'Movsw_m16_m16':['movs',2],'Movsd_m32_m32':['movs',4],'Stosb_m8_AL':['stos',1],'Stosw_m16_AX':['stos',2],'Stosd_m32_EAX':['stos',4]}[i.code];
    if(string) {
      if(i.lock||i.repne||!['None','DS'].includes(i.segmentPrefix)||!i.operands.some(o=>o.name==='MemoryESEDI'))throw new Error('unsupported string addressing/prefix');
      return {supported:true,body:`s.string('${string[0]}',${string[1]},${!!i.rep});${next}`};
    }
    if (i.prefixed) throw new Error('lock/repeat prefix');
    if(i.code==='Wait')return {supported:true,body:`s.waitFpu();${next}`};
    if(i.code==='Fninit')return {supported:true,body:`s.resetFpu();${next}`};
    if(i.code==='Fnclex')return {supported:true,body:`s.fpu.status&=~255;${next}`};
    if(i.code==='Fnstcw_m2byte')return {supported:true,body:write(a,'s.fpu.control')+next};
    if(i.code==='Fldcw_m2byte')return {supported:true,body:`s.fpu.control=${read(a)};${next}`};
    if(i.code==='Fnstsw_AX'||i.code==='Fnstsw_m2byte')return {supported:true,body:write(a,'s.fpu.status')+next};
    if(i.code==='Stmxcsr_m32')return {supported:true,body:write(a,'s.mxcsr')+next};
    if(i.code==='Ldmxcsr_m32')return {supported:true,body:`const v=${read(a)};if(v&0xffff0000)s.unsupported('reserved MXCSR bits');s.mxcsr=v;${next}`};
    if(i.code==='Bsf_r32_rm32'||i.code==='Bsr_r32_rm32')return {supported:true,body:`const v=${read(b)};s.flags=(s.flags&~64)|(v?0:64);s.known=64;if(v){${write(a,i.mnemonic==='Bsf'?'31-Math.clz32(v&-v)':'31-Math.clz32(v)')}}${next}`};
    const st=operand=>{
      const match=operand?.name?.match(/^ST([0-7])$/);if(!match)throw new Error('Unsupported x87 register');return Number(match[1]);
    };
    if(['Fld_m32fp','Fld_m64fp','Fild_m16int','Fild_m32int','Fild_m64int'].includes(i.code))return {supported:true,body:`s.fpu.load(s.mem,${address(a)},${a.size},${i.mnemonic==='Fild'});${next}`};
    if(i.code==='Fld_sti')return {supported:true,body:`s.fpu.push(s.fpu.get(${st(a)}));${next}`};
    if(i.code==='Fld1'||i.code==='Fldz')return {supported:true,body:`s.fpu.push(${i.code==='Fld1'?1:0});${next}`};
    if(i.code==='Fxch_st0_sti')return {supported:true,body:`s.fpu.exchange(${st(b)});${next}`};
    if(/^(Fstp?|Fistp?|Fisttp)_m(?:32fp|64fp|16int|32int|64int)$/.test(i.code))return {supported:true,body:`s.fpu.store(s.mem,${address(a)},${a.size},{integer:${i.mnemonic.startsWith('Fist')},pop:${i.mnemonic.endsWith('p')},truncate:${i.mnemonic==='Fisttp'}});${next}`};
    if(i.code==='Fstp_sti'||i.code==='Fst_sti')return {supported:true,body:`s.fpu.set(${st(a)},s.fpu.get());${i.mnemonic==='Fstp'?'s.fpu.pop();':''}${next}`};
    if(['Fadd','Faddp','Fsub','Fsubp','Fsubr','Fsubrp','Fmul','Fmulp','Fdiv','Fdivp','Fdivr','Fdivrp'].includes(i.mnemonic)){
      const kind=i.mnemonic.slice(1,4),reverse=i.mnemonic.includes('r'),pop=i.mnemonic.endsWith('p');
      let left,right,destination;
      if(a.kind==='mem'){
        if(![4,8].includes(a.size))throw new Error('Unsupported x87 memory width');
        left='s.fpu.get()';right=`s.mem.readBytes(${address(a)},${a.size}).read${a.size===4?'Float':'Double'}LE()`;destination=0;
      }else {destination=st(a);left=`s.fpu.get(${destination})`;right=`s.fpu.get(${st(b)})`;}
      if(reverse)[left,right]=[right,left];
      return {supported:true,body:`s.fpu.set(${destination},s.fpu.binary('${kind}',${left},${right}));${pop?'s.fpu.pop();':''}${next}`};
    }
    if(i.code==='Fchs'||i.code==='Fabs')return {supported:true,body:`s.fpu.set(0,${i.code==='Fchs'?'-s.fpu.get()':'Math.abs(s.fpu.get())'});${next}`};
    if (i.mnemonic === 'Mov')
      return { supported: true, body: write(a, read(b)) + next };
    if (i.mnemonic==='Movzx'||i.mnemonic==='Movsx') {
      const bits=width(b); if(bits>=width(a))throw new Error('invalid extension width');
      const value=i.mnemonic==='Movzx'?read(b):`((${read(b)}<<${32-bits})>>${32-bits})`;
      return {supported:true,body:write(a,value)+next};
    }
    if (binaries.has(i.mnemonic)) {
      // Register/memory operands are checked by read/write. Reject byte/word forms
      // with immediate-only or implicit operands by requiring a 32-bit code form.
      const bits=width(a);
      const kind = i.mnemonic.toLowerCase();
      const expression = ['Add', 'Sub', 'Adc','Sbb','Cmp'].includes(i.mnemonic)
        ? `s.arithmetic('${kind === 'cmp' ? 'sub' : kind}',a,b,${bits})`
        : `s.logic('${kind === 'test' ? 'and' : kind}',a,b,${bits})`;
      return { supported: true, body: `const a=${read(a)},b=${read(b)};const v=${expression};${['Cmp','Test'].includes(i.mnemonic) ? '' : write(a, 'v')}${next}` };
    }
    if (i.code === 'Lea_r32_m' && a.kind === 'reg' && b.kind === 'mem')
      return { supported: true, body: write(a, address(b,false)) + next };
    if(['Inc','Dec','Neg','Not'].includes(i.mnemonic)) {
      const bits=width(a);
      const value=i.mnemonic==='Not'?`(~a)`:i.mnemonic==='Neg'?`s.arithmetic('sub',0,a,${bits})`:`s.increment(a,${i.mnemonic==='Inc'?1:-1},${bits})`;
      return {supported:true,body:`const a=${read(a)};const v=${value};${write(a,'v')}${next}`};
    }
    if(i.code==='Leaved')return {supported:true,body:`s.r[4]=s.r[5];s.r[5]=s.pop();${next}`};
    if(i.code==='Cld'||i.code==='Std')return {supported:true,body:`s.flags${i.code==='Cld'?'&=~':'|='}1024;${next}`};
    if(i.code==='Cli'||i.code==='Sti')return {supported:true,body:`s.flags${i.code==='Cli'?'&=~':'|='}512;${next}`};
    if (['Push_r32','Push_rm32','Pushd_imm8','Pushd_imm32'].includes(i.code))
      return { supported: true, body: `s.push(${read(a)});${next}` };
    if (i.code === 'Pop_r32') return { supported: true, body: write(a, 's.pop()') + next };
    if (i.code === 'Cdq') return { supported: true, body: `s.r[2]=(s.r[0]&0x80000000)?0xffffffff:0;${next}` };
    if (i.code === 'Idiv_rm32') return { supported: true, body: `s.idiv(${read(a)});${next}` };
    if (i.code === 'Div_rm32') return { supported: true, body: `s.divide(${read(a)});${next}` };
    if (i.code === 'Mul_rm32'||i.code==='Imul_rm32')return {supported:true,body:`s.multiply(${read(a)},${i.mnemonic==='Imul'});${next}`};
    if (['Imul_r32_rm32','Imul_r32_rm32_imm8','Imul_r32_rm32_imm32'].includes(i.code)){
      const left=i.operands.length===3?read(b):read(a),right=i.operands.length===3?read(i.operands[2]):read(b);
      return {supported:true,body:`const v=s.multiply(${right},true,${left});${write(a,'v')}${next}`};
    }
    if (['Shr','Shl','Sar'].includes(i.mnemonic)) {
      const bits=width(a),count=b?.kind==='reg'&&b.name==='CL'?'(s.r[1]&255)':read(b);
      return { supported: true, body: `const v=s.shift('${i.mnemonic.toLowerCase()}',${read(a)},${count},${bits});${write(a,'v')}${next}` };
    }
    if (conditional.has(i.mnemonic) && a?.kind === 'branch' && /_32$/.test(i.code))
      return { supported: true, body: `return s.condition('${i.mnemonic}')?${a.value}:${i.next};` };
    if (['Jmp_rel8_32','Jmp_rel32_32','Jmp_rm32'].includes(i.code)) return { supported: true, body: `return ${read(a)};` };
    if (['Call_rel32_32','Call_rm32'].includes(i.code)) return { supported: true, body: `const target=${read(a)};s.push(${i.next});return target;` };
    if (['Retnd','Retnd_imm16'].includes(i.code)) return { supported: true, body: `const target=s.pop();s.r[4]=(s.r[4]+${a?.value ?? 0})>>>0;return target;` };
    if (i.code === 'Nopd') return { supported: true, body: next };
    if(i.mnemonic.startsWith('Set')){
      const condition='J'+i.mnemonic.slice(3);if(!conditional.has(condition)||width(a)!==8)throw new Error('Unsupported SETcc form');
      return {supported:true,body:`const v=s.condition('${condition}')?1:0;${write(a,'v')}${next}`};
    }
    if(i.mnemonic.startsWith('Cmov')){
      const condition='J'+i.mnemonic.slice(4);if(!conditional.has(condition))throw new Error('Unsupported CMOVcc form');
      return {supported:true,body:`const v=${read(b)};if(s.condition('${condition}')){${write(a,'v')}}${next}`};
    }
    throw new Error(`instruction form ${i.code}`);
  } catch (error) {
    return { supported: false, reason: error.message, body: `s.unsupported(${JSON.stringify(`${i.assembly} (${error.message})`)});` };
  }
}

export function emitModule(instructions, fingerprint) {
  const lines = [`// PRIVATE: generated locally from a user-supplied executable.`, `export const fingerprint=${JSON.stringify(fingerprint)};`, 'export const translated=new Map(['];
  for (const instruction of instructions) lines.push(`[${instruction.address},s=>{${lift(instruction).body}}],`);
  lines.push(']);', 'export const descriptions=new Map(' + JSON.stringify(instructions.map(i => [i.address, i.assembly])) + ');', 'export const instructionRanges=' + JSON.stringify(instructions.map(i => [i.address, i.length])) + ';', '');
  return lines.join('\n');
}
