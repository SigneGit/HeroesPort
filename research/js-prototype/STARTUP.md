> Archived JavaScript prototype checkpoint. The active native build is documented in docs/NATIVE.md.

# Startup execution checkpoint

## Current result

The supported USA user executable now executes **over 260,000 translated x86 instructions** through XDK initialization and game-specific C++ initializers. The current stop is `HalGetInterruptVector`, kernel ordinal **44**, requested for IRQ **1** during USB/device initialization. No game window, rendered frame, audio or playable scene exists yet.

A run with the existing per-title files executes **261,509 instructions**. The isolated integration test with fresh user data executes **263,889 instructions**, including extra metadata-file creation. These are deterministic diagnostic checkpoints for this revision, not performance figures or percentages of the game ported.

The tool decodes original instructions ahead of execution and emits JavaScript operations into `local/recompiled/startup.mjs`. Generated modules execute without a decoder dependency. This is a testable prototype backend in Node.js; native C++/LLVM output and a desktop game runtime remain future work.

## Run and inspect

```powershell
node research/js-prototype/tools/advance-startup.mjs
# Or run an existing translation:
node research/js-prototype/tools/probe-startup.mjs
```

The advancement command follows direct flow and configured initializer tables, runs the translation, records an encountered indirect target, and repeats compilation/execution up to twelve times. It does not guess success at unsupported instructions or imports. Analysis starts from the verified source image on each pass. `local/recompiled/discovered-targets.json` is private, build-fingerprinted analysis data.

Exit status **2** means a known execution boundary was reached. Exit status **1** means a tool/setup error. Exit status **0** only means all diagnostic guest threads returned; it would not establish gameplay compatibility.

`local/recompiled/startup-trace.json` includes the stop, thread states, kernel calls, file operations, and ordered memory-write records. Instruction tracing retains the first 512 and most recent 4,096 completed instructions, with an omitted-count field. Bulk writes record their location and size. The default execution budget is one million instructions; `--steps` accepts up to two million.

## Implemented runtime foundation

| Area | Current behavior |
| --- | --- |
| Guest threads | Private stacks, TLS reservation, PCR/FS state, IDs/handles, cooperative switching, suspension/resume, termination |
| TLS | Original game wrapper executes its template copy and zero fill; it writes the expected -37 index for a 148-byte allocation |
| Memory | Per-page reserve/commit/decommit/release, read/write/execute permissions, bounded allocations, contiguous physical ranges with alignment and free-range reuse |
| Scalar x86 | Partial registers, FS addressing, integer arithmetic/logic, carry operations, shifts, multiply/divide, string copy/fill, conditions, calls/returns, bit scans |
| Synchronization | Recursive critical sections, event/timer initialization, timer arming/cancellation, IRQL state; unsupported contention/DPC work stops explicitly |
| File I/O | Guest names/links and handles, synchronous file reads/writes, selected file/volume metadata; writes restricted to private user storage |
| XBE sections | Source-backed load and reference counts; unload makes a section inaccessible until reloaded |
| Kernel metadata | Pinned public ABI map, explicit virtual hardware/kernel version, selected configuration/data exports |
| Device objects | Guest device objects and extensions can be created; host USB/controller dispatch is not implemented |
| Floating point | Restricted normal binary64 x87 operations, stack/control state, integer conversion; partial floating-point status support |

Unsupported kernel data exports remain unmapped rather than exposing invented firmware data. Unsupported services preserve the execution boundary. No game code executes directly as native machine instructions on the host.

## PC launch and host bridges

The virtual hardware configuration is explicit in `research/js-prototype/config/virtual-xbox.json`. It is a synthetic compatibility environment, not an Xbox firmware dump. Its timing is deterministic diagnostic time, not a measured Xbox scheduler.

The PC loader mounts verified imported assets at a virtual hard-drive game folder. It sets the loaded certificate's allowed media to hard drive and clears the extension flag that forces a physical DVD check. These adjustments are logged. The user's XBE on disk is unchanged. Physical DVD authentication, raw disk formatting and host device passthrough are not implemented.

`local/userdata` backs per-title `TDATA`/`UDATA` directories and cache files. Asset files are read-only. Paths are case-insensitive at the guest interface and reject traversal, alternate streams, device names and host links. A clean utility-cache request allocates a fresh cache directory; it does not delete previous title data.

Two build-specific host bridges are listed in `research/js-prototype/config/xdk-bridges.json`:

- `XMountUtilityDrive` at `0x00058957` mounts private cache storage. Its identity and stdcall contract are inferred from this executable's callers, `Z:` link creation and return sequence. Raw FATX disk formatting is replaced by that filesystem operation.
- The internal CRT `pow` helper at `0x00221fa4` consumes the exponent/base from the x87 stack and produces the host binary64 power result. Its contract is inferred from the helper and allocation-table caller. This is a host math replacement, not bit-exact x87 transcendental emulation.

Bridge invocations appear in the trace. Unsupported precision modes, exceptional/extended-range x87 arithmetic and unimplemented instructions still stop. Floating-point condition/exception handling is incomplete, and the host `pow` bridge can differ from Xbox results. A full Xbox reference trace has not yet been obtained.

## Validation

The current suite has **53 passing tests** when run on this machine with the user-game integration checks enabled. Coverage includes parser bounds, guest permissions, TLS and thread ABI, recursive locks, VM lifecycle, physical allocation reuse, fastcall stack handling, file isolation/persistence, cache formatting, junction rejection and explicit unsupported-service behavior.

The optional Windows x64 oracle executes original synthetic instructions only. It compares 8,500 integer arithmetic/shift vectors and 48 x87 integer conversions with host CPU results and defined flags/status. It does not establish full x87 equivalence or validate the whole game's execution.

The original checkpoint remains available:

```powershell
node research/js-prototype/tools/probe-startup.mjs --stop-before-kernel
```

That stops after 50 instructions at `PsCreateSystemThreadEx` with a 256 KiB requested stack, 148 TLS bytes, start routine `0x00055bed`, and system wrapper `0x000562eb`.

## Next boundary

The current USB initialization path asks for IRQ 1's vector and IRQL, then will require interrupt connection and hardware/controller behavior. Implement a coherent virtual interrupt/device backend or explicit host input bridges with verified contracts. Returning a vector alone would not complete device initialization.

After this boundary, continue toward D3D8/NV2A graphics setup, audio, controller events, saves and the first rendered frame. The number of translated instructions alone cannot establish correctness in those systems.
