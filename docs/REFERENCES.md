# Format and tooling references

These references informed binary field interpretation; no implementation source was copied into this project.

- [XboxDev extract-xiso](https://github.com/XboxDev/extract-xiso): primary implementation of Xbox disc image extraction and filesystem structures.
- [XboxDev nxdk Xbe.h](https://github.com/XboxDev/nxdk/blob/master/tools/cxbe/Xbe.h): primary XBE writer structure definitions, including headers, certificates, sections, and library versions.
- [XboxDev nxdk Xbe.cpp](https://github.com/XboxDev/nxdk/blob/master/tools/cxbe/Xbe.cpp): executable encoding and section construction.
- [Ghidra repository](https://github.com/NationalSecurityAgency/ghidra) and [Ghidra API documentation](https://ghidra.re/ghidra_docs/api/): analysis, scripting, instruction listing, and p-code interfaces. Ghidra is an external analysis dependency and has not been bundled.
- [iced-x86 JavaScript bindings](https://github.com/icedland/iced/tree/master/src/rust/iced-x86-js): MIT-licensed decoder for the archived JavaScript prototype, pinned in `package-lock.json`. The active native SDK uses Zydis instead.
- [nxdk Xbox kernel exports](https://github.com/XboxDev/nxdk/blob/master/lib/xboxkrnl/xboxkrnl.exe.def) and [kernel declarations](https://github.com/XboxDev/nxdk/blob/master/lib/xboxkrnl/xboxkrnl.h): CC0 interface metadata identifying ordinal 255 and its thread-creation ABI. These declarations do not provide a host implementation.
- The archived prototype's public ABI snapshot in `research/js-prototype/config/kernel-abi.json` is pinned to nxdk revision `fafbe41b48fa00a31b79dd49ad1f86a30adcdd9e`, with source URL, SHA-256 and CC0 attribution. Its maintenance tool is archived alongside it. The active SDK supplies its own kernel definitions.
- [Cxbx-Reloaded XBE declarations](https://github.com/Cxbx-Reloaded/Cxbx-Reloaded/blob/master/src/common/xbe/Xbe.h): consulted for the certificate extension/security-field layout. [HAL export implementation](https://github.com/Cxbx-Reloaded/Cxbx-Reloaded/blob/master/src/core/kernel/exports/EmuKrnlHal.cpp): consulted while identifying the upcoming USB IRQ boundary. No GPL implementation code is copied or bundled.
- [Microsoft SCSI pass-through interface documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddscsi/ns-ntddscsi-_scsi_pass_through_direct): consulted to identify the physical-DVD IOCTL path. This port instead mounts imported files in a virtual hard-drive folder; it does not send SCSI requests to the user's drives.

The initial tools implement a bounded subset: supported XDVDFS partition offsets and retail/debug original Xbox XBE metadata. They do not parse Xbox 360 XEX, decrypt other formats, verify XBE signatures, or prove that a disc was legally acquired.

The active native source is the user-supplied XboxDecomp snapshot under `third_party/xboxdecomp`, with its original license, notices, SHA-256 provenance and maintained local patch record. See `third_party/README.md` and `docs/NATIVE.md` for the integration boundary. The separate Darkwatch source directory was reviewed as a reference; its game-specific source was not copied into this port.
