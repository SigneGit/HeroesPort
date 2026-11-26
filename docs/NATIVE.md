# Native XboxDecomp migration

The active port uses the source snapshot under `third_party/xboxdecomp`. It translates the player's verified XBE into C++ and provides the Windows kernel, D3D12, XAudio2 and SDL integration. The previous JavaScript translator/runtime is archived under `research/js-prototype` and is not linked into this build.

## Implemented migration

- Preserved the existing strict ISO importer, supported executable fingerprint, and synthetic parser tests.
- Vendored the user-supplied SDK with original MIT/third-party notices, content provenance, and an explicit scanner patch.
- Built working `xbe_symbols.exe` and `xbe_recomp.exe` using the existing MinGW compiler. These are analysis/code-generation tools, not the game runtime.
- Created a Heroes-specific native CMake project, title registration, in-memory launch-media adjustment, profile and partial XDK 5455 layout.
- Enabled 107 function mappings out of 249 available names and ten data mappings out of 13. Manually reviewed mappings supplement conservative scanner matches. Conflicting cross-build candidates and constant-similarity guesses remain disabled.
- Generated private C++ in `native/generated/heroes`. Recompilation reports overlapping decodes and unsupported forms; generation alone does not prove executable correctness.
- Completed the Windows native build, producing private `Heroes.exe` and `Heroes.dll` development outputs.
- Replaced device creation, default-state setup, resource synchronization, multisampling, shader selection and refresh timing using the SDK renderer. Added 36 individually reviewed controller, graphics and effects-image layout facts and an audio-buffer format mapping.
- Implemented host-owned audio-buffer playback notifications, speaker routing and bin volumes, with a documented SDK patch and native traversal tests.
- Mapped the main draw functions, primitive end and target/depth clear. Intro videos and an animated menu scene were observed. The user confirmed that the main menu renders correctly and audio works after the draw/clear mappings.
- Added a focus-aware keyboard controller through Heroes' existing `GameInfo::pad` callback. It merges into player one and retains SDL controller support. The user confirmed keyboard input; the user subsequently confirmed entry into gameplay.

The user has confirmed playable wizard gameplay, movement, combat and spellcasting. Additional graphics entry points, shader/device fields and sound-stream layouts still need analysis. Missing mappings/layouts use the SDK's diagnostic failure paths.

## Build sequence

The current workspace already has the verified game import and SDK snapshot. A fresh setup must first run the importer with the user's own supported ISO. Original game files, generated C++, objects and DLLs are excluded from version control.

```powershell
node tools/setup-native-deps.mjs
node tools/build-native-tools.mjs
node tools/prepare-native.mjs
node tools/recompile-native.mjs
```

The dependency setup fetches pinned commits of Zydis, Zycore, toml++, Dear ImGui and SDL3 into `local/native-deps`. MinGW tool builds default to `C:/msys64/mingw64/bin/g++.exe`; `HEROES_CXX` can select another installed MinGW compiler. This compiler only builds the portable analysis tools.

The native Windows host requires Visual Studio C++ Build Tools, the Windows SDK, Clang, CMake and Ninja. The approved installation helper installs the main tools to `C:/BuildTools/Heroes` and shared Microsoft components to their standard locations. It does not restart Windows.

```powershell
./tools/build-native.ps1 -Stage Configure
./tools/build-native.ps1
```

The wrapper discovers the installed MSVC toolchain, loads its environment, selects Clang/Ninja, prepares the profile, and builds `native/out/build/release/Heroes.exe` and the private game DLL. The SDK also supports first-run compilation from a player's XBE. A distributable package/allowlist has not yet been implemented here; do not treat the development output directory as a release package.

`native/assets` is a project-local junction to the existing verified import. This avoids duplicating 2.7 GB of data. Preparation checks its resolved target before use. A sandbox can require approval to create the junction; it does not modify the original ISO or source XBE.

## Profile evidence and unknowns

The supplied SDK has no complete XDK 5455 profile. Its scanner normally rejects this build. The local scanner patch lets research explicitly compare against another signature set without changing the actual XBE build identity.

`prepare-native.mjs` scans both 4831 and 5849 reference signatures and records candidates/evidence under `local/native-analysis`. Promotion accepts matching masked-byte signatures, explicit XTLID identities, and reviewed facts from `native/config/verified.json`. Disagreeing references and multiple named functions claiming one address are rejected. Constant-similarity matches are research suggestions only.

The controller record at `0x2907b4` is supported by its use as the game's `XInputOpen` type argument and the class resolver's matching type pointer. `XGetDevices` at `0x291a19` proves the record fields at offsets 0, 4 and 8. Reviewed graphics and effects-image facts now live alongside it in `verified.json`, including instruction addresses and reasons. Preparation generates the layout TOML from those facts. No layout is borrowed merely because its XDK version is nearby.

Heroes' `Direct3D_CreateDevice` entry at `0x24e8e0` publishes device `0x251980` through pointer `0x251978`, returns with six stack arguments removed, and clears `0x2080` bytes on failure. Setters/getters establish the resource fields; the miniport's interrupt handler establishes refresh count/event/callback fields. Effects-image parsing at `0x258d58` through `0x258d67` establishes its three header offsets. Fourteen optional integration tests check these contracts against the private user image.

`heroes-hooks.toml` skips exactly one title-side GPU-register write at `0x7e18d`, resuming at the next instruction. The PC renderer owns hardware setup; the original XBE is unchanged. The write's effect on final rendering still needs visual comparison. This does not map or ignore arbitrary MMIO accesses.

Generated outputs and scan reports are private. Public profiles contain addresses, layout facts and fingerprints, not original instruction bytes. Native tests exercise a synthetic XBE, validate provenance and guard the conservative promotion policy.

## Current checkpoint and remaining work

The expanded Cheats tab adds temporary health, inventory, move/melee, gem availability, buff HUD, auto-revive, XP-freeze, player-circle and combat options, plus a separate permanent-actions section. XP editing is deliberately permanent; XP freeze is the temporary alternative. The inactive Easy Blocking/Always Combo debug callbacks are replaced by explicitly labeled 90% damage reduction and repeat-A input. Health and inventory/rank baselines are kept on the title thread; positive stock changes accrue to real inventory while consumption of borrowed stock does not spend the baseline. Native snapshot entry `0xD4A50`, actor copy `0xC58D0`, party removal `0xB3B90` and actor constructor `0xD0B20` prevent copied/stale overlays from becoming character baselines. Quest copy `0x107420` restores borrowed flag bytes, and native setter `0x10793E` retains legitimate quest writes. Buff preview removes only zero-strength records it created, preserving existing or legitimately replaced buffs. These restore paths and combat filtering are exercised against synthetic guest memory using the actual host hook implementation; private-image checks establish instruction/register contracts. Full save/reload and all scene transitions still require broader live coverage.

The first one-hit implementation covered only the base receiver at `0xF6EC6`; the user's live test found it ineffective against ordinary monsters. Monster vtable `0x2A6438` routes slot `0x198` through `0xDBC70` and `0xF7F60` into deferred actor damage at `0x1BFAB0`. The corrected hook at `0x1BFC21` sees the descriptor in EBX and attacker at `[esp+0x1C]`, immediately before the native health subtraction. Both receivers restrict one-hit effects to positively damaged monster instances hit by a party hero or its owned attack. The RTTI boolean is read from AL, preserving the distinction from unrelated upper EAX bits. The original damage descriptor is never modified. Scripted invulnerable phases and non-monster props retain native handling. The user confirmed the corrected one-hit cheat working; gameplay logs show several matching party-to-monster hits and approximately 60 FPS. The final host-only filtering rebuild and all 53 regression checks passed, including a false RTTI result with nonzero upper EAX bits. The other expanded menu options were reported working in the menu; broader feature-by-feature/save-reload coverage remains outstanding.

The original item grant fills slots 21–149 with 1000, except 95/96 with 999, and sets the separate skeleton-key count to 999. It does not grant every weapon/armor piece. Gem availability maps to quest flags 101 (Fire), 100 (Nature/Earth), 102 (Ice), 26 (Wind), 103 (Death/Bone). The original callback additionally sets flag 405; its purpose remains unidentified. The English item labels and native gem-query reads were inspected from the private import; the complete private catalog is `local/native-analysis/cheat-grants-catalog.txt`. Saves taken before the expansion test were copied to `local/native-analysis/cheats-save-backup-20261122-212808`.

The F11 Cheats tab has session-only God mode and Unlimited mana switches, initially disabled. Fingerprint-specific hooks at `0xB90F3` and `0xC55F0` select the original invulnerability branches only for entities in the party table. They do not write the entity's invulnerability flag, so disabling the switch resumes native behavior immediately. At the gameplay present wrapper `0x69410`, a title-thread hook refills living heroes' current mana to their current maximum; the ImGui thread only changes atomic switches. Player pointers are resolved anew each tick, with committed-memory checks, and are never cached across scene changes. Native debug callbacks independently identify the singleton at `0x49D0B8`, manager at `+0x14`, player table at `+0x246F8`, health at `+0x74`, and current/max mana at `+0x24B0/+0x24B4`. Private-image checks verify those references, the debug labels/vtables and the original invulnerability exits. A portable native test rejects mana writes for dead heroes, disabled cheats, nonfinite values and temporary over-max resources. The user confirmed the gameplay test of enabled/disabled cheats working; diagnostics also record actual mana refills. The build and all 51 regression checks passed. Scripted damage and additional scene/character transitions still need broader coverage. Private test logs are retained at `local/native-analysis/cheats-gameplay.log`.

The November 22 performance pass corrected two sustained gameplay bottlenecks. The vertical-blank wrapper now waits for the next tick on a shared 60 Hz clock instead of adding a full 16 ms sleep after work. A fingerprint-specific hook at `0x65069` sends the linear-color screen-copy branch directly through CopyRects, then resumes its original two surface releases at `0x65162`. This branch never consumes the locked CPU pixels; other formats and their CPU conversions retain their original path. Set `HEROES_CPU_SCREEN_COPY=1` before launch to compare with the original copy path.

In the user's tested crypt gameplay, earlier 34–35 FPS samples had roughly 10–11 ms/frame of title-thread readback waits. The rebuilt host logged approximately 59.9–60.1 FPS, 0.00 ms/frame readback waits and no recurring GPU readbacks/downsamples or full-screen texture uploads, including scenes above 4,000 draws/frame. The new pacing counters confirm one explicit vertical-blank wait per gameplay frame. The user confirmed steady 60 FPS and no observed visual or game-speed issues in this test. This does not validate every level/effect or gameplay above 60 FPS; the cap remains 60. Private logs are retained under `local/native-analysis/fps-fixed.log`.

The user has now entered gameplay, selected a wizard, watched the opening cinematic, moved, attacked and cast spells. The first gameplay compatibility pass added five reviewed graphics mappings (render targets, depth/stencil enable, texture factor and pixel texture modes) and corrected overflowing save-volume geometry. The user confirmed removal of the repeated H characters and corrected water effects; the wizard staff remained invisible after that first batch. GPU capture then identified missing fixed-function material/light state; three additional mappings now supply it, and the user confirmed that the staff is visible. The build succeeds and all 43 checks pass, including private-image evidence and native volume tests. See [the complete defect ledger](GAMEPLAY-BUGS.md) for unresolved rendering, fonts, equipment and save/load validation.

The original GPU initialization write at `0xFD001804`, title-side write at `0xFD400880`, missing DSP offsets, missing vertical-blank event and original GPU fence waits have been addressed. Startup then passed multisampling/shader setup and reached sound-buffer format conversion. The original format setter was operating on an SDK-owned buffer, resulting in a null-derived destination pointer in the ADPCM conversion helper. `IDirectSoundBuffer_SetFormat` at `0x2578f2` now uses the existing host implementation and the next launch progressed beyond that failure.

The fault at guest address `0xD8` was the missing playback-notification API, now implemented on the host mixer. Additional sound-routing mappings moved startup past the other audio object faults. A 60-second diagnostic launch remained alive, played the intros and rendered the menu scene. Short 15–20 second timeouts were interrupting normal video playback, not proving a startup hang.

The keyboard controller exposed another original audio call during the menu transition: `IDirectSoundBuffer_SetOutputBuffer` at `0x257312` read a null internal voice pointer at +0xB0 from an SDK-owned buffer. Its verified mapping now uses the host implementation, which preserves mix-bin routing. Validate navigation after this fix, then enter a scene and audit further object-boundary calls as they execute.

The user subsequently confirmed keyboard input but reported a port-one reconnect warning. Controller initialization calls `XInputGetCapabilities` at `0x291774` immediately after the host `XInputOpen`. That query was unmapped: its original USB implementation dereferences the virtual handle's empty device pointer and returns 1167 (not connected). The profile now uses the existing SDK capabilities implementation, which returns a gamepad subtype and the 25-byte capability report for connected virtual/physical pads. A private-image regression checks the actual call site, original failure path, report size and two-argument ABI. That checkpoint passed 35 checks; the current suite is described below.

`tools/run-native.ps1` leaves the game running for interactive testing. The smoke test intentionally stops its own process at the deadline; a timeout is not a crash. For detailed logs set `XBE_VERBOSE=1` and optionally `XBE_PERF=1` before launch. F3 invokes SDK thread diagnostics. Normal release logging remains unchanged when these variables are absent.

Native tests cover notification boundaries, loop wraparound, stop markers, ADPCM offsets, keyboard focus/merging and private-image ABI evidence. User-confirmed gameplay does not establish save/load, co-op or rendering fidelity.

Startup still reports failed large contiguous-allocation attempts before falling back. Their effect on the game's memory budget remains to be investigated. Audit overlapping decodes as executed paths expose them. Audio fidelity, controller behavior and gameplay need actual runtime validation, regardless of the SDK's general capabilities.

`tools/smoke-native.ps1` records the native process exit status and log location in `local/native-analysis/boot-result.json`. A crash or timeout returns a failing script exit status. Even a zero process exit status is only a diagnostic result, not proof of a rendered frame or gameplay.

The subsequent texture pass mapped `SetTextureState_TexCoordIndex` at 0x2445C0 and `CopyRects` at 0x241560. The user confirmed corrected walls after coordinate selection, corrected pedestal texture/model appearance after surface copying, and then corrected floor/wall seams and black borders. Fonts and font colors were also confirmed fixed after reopening. The active profile has 107 function mappings and 43 passing checks. Diagnostic captures retain native vertex/UV values, requested sampler state and private raw texture bytes for future comparisons. The trial sampler-clamping change was reverted after no visual improvement.

The damage-number pass now preserves current diffuse vertex attribute 3 when its input array is absent, instead of substituting white. This covers the captured number/shadow billboards and retains explicit per-vertex colors. Native shader-generator and private-image regressions raise the active suite to 43 checks. Ground pickups are user-confirmed visible; the user confirmed that damage numbers and their shadows now look correct.
# Finisher charge cheat

F11 → Cheats includes session-only Unlimited special charges (finishers). The native update at `0xD645C`/`0xD64B5` checks equipped move indices at `+0x1B00`/`+0x1AFC`, whose action pointers are at `+0x3C0 + index*16`; action byte `+0x106` is bIsFinisher. The charge meter is float `+0x1B08`; HUD `0x39471` caps its display at three. The title-thread cheat holds this meter at three only for living heroes with a selected finisher. It snapshots the original meter and restores it when disabled, unequipped, or before reviewed save/copy boundaries. Normal charge accumulation/decay is suspended while borrowed charges are active. It does not unlock a finisher or change mana, skill ranks or item counts. Host tests cover both slots, repeated consumption, disable/unequip, and save/copy restoration; private-image checks confirm the original instructions. Native build passed; gameplay confirmation is pending.

