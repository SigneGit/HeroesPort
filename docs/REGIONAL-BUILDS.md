# Regional builds

The supplied USA, Europe, France, Italy, and Spain images are supported by exact
executable and complete extracted-file fingerprints in `config/supported-build.json`.
ISO container sizes and padding can differ; the extracted file inventory must match.
The supplied French disc has 481 files; the other four have 480.

USA uses `heroes-usa.toml`. The four PAL executables use `heroes-pal.toml` and
`heroes-pal-hooks.toml`. Their entry point is `0x55CE1`, compared with USA's
`0x55C61`. PAL game functions have several different address shifts; a single
global offset does not describe the code. The SDK sections and game globals
used by the host move by `0x140`.

`native/config/pal-addresses.json` records the specific game address mapping.
Hook locations, continuation targets, and host guest-call targets were matched
using unique instruction windows around their USA counterparts. Comparisons
retain opcodes, registers, small constants, and small member offsets while
masking relocated 32-bit operands and relative branches. All 101 enabled SDK
entries in those sections also retain matching instruction windows. The
European executables share these mappings; their full executable fingerprints
remain distinct. `verified-pal.json` records relocated reviewed SDK facts.

The host selects its guest-address mapping after loading the verified image.
All native profiles set `[xbe] named = true`. This makes the shared host's Xbox
API overrides and data references resolve through each DLL's `X86Symbols` table.
Address-based binding silently misses PAL overrides: its original utility-drive
setup tries to open the console's raw partition and exits to the dashboard.
Changing game hooks alone is insufficient; host and gameplay DLLs must both be
rebuilt when switching the binding mode.
Its release allowlist includes all five XBE SHA-1 values. Preparation selects
the matching compiler profile and writes an SDK cache stamp binding the DLL to
the imported executable and host. A different region cannot silently reuse an
existing import. Move the existing import aside before preparing another
version, or use a separate portable folder.

All five supplied images passed complete extraction, inventory verification,
C++ generation, compilation, and DLL linking. Synthetic hook tests cover both
USA and PAL cheat addresses. User testing found no additional regional problems and confirmed the clean
build through RecompLauncher Easy Setup and Play. Full-game, save/load,
language presentation, and co-op coverage still need broader playtesting.

After enabling named bindings, all four PAL test builds were launched and
confirmed running at the main menu. `tools/smoke-regional-builds.ps1` repeats
that check against `local/regional-test-builds`, stops only its own test
processes, and writes `startup-smoke.json`. A successful compilation alone
does not establish startup compatibility.

To repeat the private executable comparison with all five ISOs:

```powershell
$env:HEROES_TEST_ISOS = 'C:\path\to\Heroes XISO'
node --test tests/regional-images.integration.test.mjs
Remove-Item Env:HEROES_TEST_ISOS
```

This test reads user-supplied images and does not store game bytes in source.
