# Archived JavaScript startup prototype

This is the previous diagnostic runtime and translator. It is retained for historical checkpoints and regression comparisons; it is not part of the native XboxDecomp build. New port work belongs in `native/` and the maintained SDK integration.

From the repository root:

```powershell
npm run test:legacy
npm run legacy:startup
```

These commands use the existing private import and `local/recompiled` output. Optional real-game checks still use `HEROES_TEST_GAME=1`. They measure the prototype's behavior, not the native SDK runtime's compatibility.

The original CPU/FS/kernel services, ABI metadata, Ghidra setup scripts and synthetic native arithmetic oracle are preserved here. Shared ISO/XBE parsers remain in the root `tools` directory. See `STARTUP.md` for the historical checkpoint; the main project README describes the active native migration.
