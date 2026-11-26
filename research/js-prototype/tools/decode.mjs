import iced from 'iced-x86';
const { Decoder, DecoderOptions, Formatter, FormatterSyntax, Code, Mnemonic, OpKind, Register, FlowControl, MemorySizeExt } = iced;

export function decode(bytes, address) {
  const decoder = new Decoder(32, bytes.subarray(0, 15), DecoderOptions.None);
  const formatter = new Formatter(FormatterSyntax.Nasm);
  decoder.ip = BigInt(address);
  const instruction = decoder.decode();
  try {
    const operands = [];
    for (let n = 0; n < instruction.opCount; n++) {
      const kind = OpKind[instruction.opKind(n)];
      if (kind === 'Register') operands.push({ kind: 'reg', name: Register[instruction.opRegister(n)] });
      else if (kind === 'Memory') operands.push({
        kind: 'mem', base: Register[instruction.memoryBase], index: Register[instruction.memoryIndex],
        scale: instruction.memoryIndexScale, displacement: Number(instruction.memoryDisplacement) >>> 0,
        segment: Register[instruction.memorySegment], size: MemorySizeExt.size(instruction.memorySize),
      });
      else if (kind === 'NearBranch32') operands.push({ kind: 'branch', value: instruction.nearBranch32 });
      else {
        const immediate = { Immediate8: 'immediate8', Immediate16: 'immediate16', Immediate32: 'immediate32', Immediate8to16: 'immediate8to16', Immediate8to32: 'immediate8to32' }[kind];
        operands.push(immediate ? { kind: 'imm', value: instruction[immediate] >>> 0 } : { kind: 'unsupported', name: kind });
      }
    }
    const flow = FlowControl[instruction.flowControl];
    return {
      address, length: instruction.length, next: Number(instruction.nextIP) >>> 0,
      code: Code[instruction.code], mnemonic: Mnemonic[instruction.mnemonic], assembly: formatter.format(instruction),
      flow, operands, prefixed: instruction.hasLockPrefix || instruction.hasRepPrefix || instruction.hasRepnePrefix,
      lock: instruction.hasLockPrefix, rep: instruction.hasRepPrefix, repne: instruction.hasRepnePrefix,
      segmentPrefix: Register[instruction.segmentPrefix],
      target: operands.find(o => o.kind === 'branch')?.value,
      bytes: Buffer.from(bytes.subarray(0, instruction.length)).toString('hex'),
    };
  } finally { instruction.free(); formatter.free(); decoder.free(); }
}

// Recursive traversal of direct control flow, not a linear sweep of executable sections.
// Computed targets, function pointers, thread entry callbacks and exception handlers remain unresolved.
export function discover(memory, layout, { maxInstructions = 200000, seeds = [layout.entryPoint] } = {}) {
  const pending = [...seeds], instructions = new Map(), calls = new Set(seeds), edges = [], outside = new Set();
  const owner = new Map(), conflicts = [];
  const isCode = address => layout.sections.some(s => s.executable && address >= s.address && address < s.address + s.fileSize);
  while (pending.length) {
    const address = pending.pop();
    if (instructions.has(address)) continue;
    if (instructions.size >= maxInstructions) throw new Error(`Analysis limit of ${maxInstructions} instructions reached; no complete report was produced`);
    if (!isCode(address)) { outside.add(address); continue; }
    const at = address - layout.baseAddress;
    const section = layout.sections.find(s => address >= s.address && address < s.address + s.fileSize);
    const instruction = decode(memory.subarray(at, Math.min(memory.length, section.address + section.fileSize - layout.baseAddress)), address);
    instructions.set(address, instruction);
    for (let byte = address; byte < address + instruction.length; byte++) {
      if (owner.has(byte) && owner.get(byte) !== address) conflicts.push({ address, overlapping: owner.get(byte) });
      else owner.set(byte, address);
    }
    if (instruction.target !== undefined) {
      edges.push({ from: address, to: instruction.target, type: instruction.flow });
      pending.push(instruction.target);
      if (instruction.flow === 'Call') calls.add(instruction.target);
    }
    if (['Next', 'Call', 'IndirectCall', 'ConditionalBranch'].includes(instruction.flow)) pending.push(instruction.next);
  }
  return { instructions: [...instructions.values()].sort((a, b) => a.address - b.address), functionCandidates: [...calls].sort((a, b) => a - b), edges, outside: [...outside], conflicts };
}
