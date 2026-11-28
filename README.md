# Dungeons & Dragons: Heroes — PC Recompilation

<a href="https://recomplauncher.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://recomplauncher.com/assets/press/launcher/badge-light.svg"><img alt="Get it on RecompLauncher" src="https://recomplauncher.com/assets/press/launcher/badge-dark.svg" height="48"></picture></a>

**Latest release: [v0.3.0 — regional game support](https://github.com/SigneGit/HeroesPort/releases/tag/v0.3.0).** Supports USA, Europe, France, Italy, and Spain.

**How to play on Windows.** Add the extracted portable release through RecompLauncher's **Settings → Developers → Add a build**. In Easy Setup, select your supported Xbox ISO or the complete extracted folder containing `default.xbe`. Once setup finishes, press **Play**. For standalone play, open `HeroesLauncher.exe` and select your ISO.

A work-in-progress native Windows PC port of the original Xbox version of **Dungeons & Dragons: Heroes**, built with the vendored **XboxDecomp / Xbox-XBERecomp** framework.

The project translates a verified Xbox executable into C++ and runs the generated gameplay code with a Windows host providing graphics, audio, input, and Xbox system services. The active renderer uses Direct3D 12, audio uses XAudio2, and controller support uses SDL3. The earlier JavaScript runtime is archived under `research/js-prototype/` and is excluded from the native build.

**You must supply your own legally acquired supported Xbox disc image.** Source and clean player packages exclude the original executable, game assets, generated gameplay C++, and gameplay DLL. These are imported or generated locally.

## Current status

Intro videos, menus, hero selection, the opening cinematic, and wizard gameplay have been confirmed working, including movement, combat, and spellcasting. Tested crypt gameplay has reached approximately 60 FPS after rendering and frame-pacing fixes.

This is still an experimental port. Full save/load behavior, co-op, physical controller coverage, audio fidelity, and rendering across the entire game need broader testing. Keep the default **60 FPS cap**; higher caps have not been validated against game timing. The optional animation-cadence experiment is not a confirmed 60 FPS animation fix.

## Requirements

### Playing a portable release

- Windows x64 and a CPU supporting the build's `x86-64-v2` instruction target.
- A DirectX 12 capable graphics system.
- Your own supported Xbox ISO (see [Supported game image](#supported-game-image)).
- A writable folder with space for the package, approximately 2.7 GB of extracted game files, generated code, compiler cache, and saves. Allow additional space for initial preparation.
- A keyboard or compatible gamepad. Keyboard input is confirmed; physical controller and co-op testing remain incomplete.

A complete portable package includes the preparation runtime and compiler. Players do **not** need installed Node.js, Visual Studio, MinGW, a source checkout, or an internet connection to prepare their game.

### Building from source

In addition to the runtime requirements:

| Requirement | Purpose |
| --- | --- |
| Node.js **22 or newer**, with npm | Import, preparation, analysis, and packaging scripts |
| Visual Studio 2022 / Build Tools with C++ x64 tools and a Windows SDK | Microsoft headers, libraries, and native build environment |
| Visual Studio LLVM/Clang tools, including `clang`, `clang++`, and `lld-link` | Compile and link the Windows host and generated game code |
| CMake **3.25+** and Ninja | Configure and build the native project |
| MinGW-w64 GCC/G++ with C++20 support | Build the standalone symbol scanner and recompiler tools |
| `tar` available on PATH | Extract pinned dependency downloads |
| Internet access during initial setup | Download npm and pinned native dependencies |

The native game uses **Clang targeting the MSVC ABI**. MinGW is a separate requirement for the standalone analysis tools.

The default MinGW compiler is `C:\msys64\mingw64\bin\g++.exe`, with `gcc.exe` alongside it. To use another installation, set this in the PowerShell session used for setup and launch:

```powershell
$env:HEROES_CXX = 'C:\path\to\mingw64\bin\g++.exe'
```

Install Visual Studio's **Desktop development with C++** workload, LLVM/Clang tools, and C++ CMake tools. An optional helper installs Microsoft Build Tools, Clang, the Windows SDK, CMake, and Ninja:

```powershell
.\tools\install-native-toolchain.ps1
```

The helper downloads and verifies Microsoft's installer, uses `C:\BuildTools\Heroes` for its main installation, and may require administrator permission. Node.js and MinGW must be installed separately.

## Supported game image

The supplied **USA, Europe, France, Italy, and Spain retail images** are supported. The importer checks the title ID and executable SHA-256, rather than accepting any image with the same game name.

| Field | Expected value |
| --- | --- |
| Title ID | `0x49470013` |
| `default.xbe` SHA-256 | `f48303a89fa9e2043d301ee6444ae69602570a03f1dd3de386f88928b5478ece` |
| USA full-disc size and CRC32 | 7,825,162,240 bytes, `4140E4E7` |

RecompLauncher uses the [Redump disc fingerprints for all five supported regions](https://github.com/libretro/libretro-database/blob/master/metadat/redump/Microsoft%20-%20Xbox.dat) for its verified-copy badge. A trimmed XISO can have a different disc checksum and still contain every correct game file. During portable setup, Heroes checks the paths, sizes, and SHA-256 hashes of the game files against the selected region’s inventory before compiling. This check also applies to extracted folders and previously imported files used for a rebuild.

The executable and complete-file fingerprints for all five versions are recorded in [`config/supported-build.json`](config/supported-build.json). The table above describes the USA version. Setup automatically selects the matching regional profile; each version retains its own assets. Unknown revisions and mixed or modified inventories are rejected.

PAL executables use a separate native profile, relocated game hooks, and region-aware host calls. All five supplied images passed extraction, inventory verification, and native compilation. All four PAL versions also passed main-menu startup checks. User testing has found no additional regional problems, and the updated clean build has been confirmed working through RecompLauncher Easy Setup and Play. This does not establish full-game or co-op coverage. See [regional build notes](docs/REGIONAL-BUILDS.md).

The v0.3.0 package includes the PAL startup fix, all five regional RecompLauncher disc fingerprints, and retries for temporary Windows extraction-folder locks. A fresh download contains no game assets, generated gameplay DLL, saves, or prior setup state. Setup detects the region automatically; use a separate extracted release folder for each version you want to keep installed.

## Play a portable release

1. Extract the **entire** release folder to a writable location.
2. Run `HeroesLauncher.exe`.
3. Select your supported Xbox ISO and click **Prepare game**.
4. Wait for extraction, verification, and local compilation to finish, then click **Play**.

Initial preparation can take several minutes. The launcher enables Play only after preparation succeeds. Temporary Windows file locks during the final extraction rename are retried automatically. Once imported, the ISO does not need to remain connected.

Keep the folder together. Extracted files live in `assets/`, generated gameplay code in `Heroes.dll`, saves in `hdd/`, settings in `heroes-settings.toml`, and logs in `logs/`. Close the game and launcher before moving the folder. If preparation fails, check `logs/prepare.log` and retry; existing imports and saves are retained.

## Build from source

Run the following commands in PowerShell from the repository root, after installing the developer requirements.

### Option A: Prepare through the launcher

Install dependencies and build the launcher without importing game data first:

```powershell
npm ci
node tools/setup-native-deps.mjs
.\tools\build-native.ps1 -LauncherOnly
```

Start the development launcher explicitly:

```powershell
$buildOutput = Join-Path (Get-Location).Path 'native\out\build\release'
Start-Process -FilePath (Join-Path $buildOutput 'HeroesLauncher.exe') -WorkingDirectory $buildOutput
```

Select your ISO and click **Prepare game**. The launcher verifies and imports the game, builds the analysis tools, prepares the native profile, and builds the game automatically. No separate full build is needed afterward. For an existing verified import, Prepare game can retry without selecting an ISO.

The development launcher needs the source tree, Node.js, MinGW, and the native Windows toolchain. This differs from a complete portable package.

### Option B: Import and build from the command line

```powershell
npm ci
node tools/setup-native-deps.mjs
node tools/heroes.mjs inspect 'C:\path\to\game.iso'
node tools/heroes.mjs import 'C:\path\to\game.iso'
node tools/build-native-tools.mjs
.\tools\build-native.ps1
.\tools\run-native.ps1
```

`inspect` reports the image's identity; `import` enforces the supported fingerprint and extracts files into `local/game/`. The command-line importer refuses to overwrite an existing import.

The build wrapper loads the Visual Studio x64 environment, selects Clang and Ninja, prepares the game profile, and runs CMake. CMake generates and compiles the gameplay code automatically. Preparation creates `native/assets` as a junction to the private import to avoid duplicating the assets.

Successful full builds produce:

```text
native/out/build/release/
  Heroes.exe          Windows host
  Heroes.dll          Gameplay code generated from your executable
  HeroesLauncher.exe  Import and settings launcher
  compiler/           Preparation tools and configuration
```

To rebuild after source changes, run `.\tools\build-native.ps1` again. To configure without compiling:

```powershell
.\tools\build-native.ps1 -Stage Configure
```

`tools/run-launcher.ps1` is also available, but **prefers `release/HeroesLauncher.exe` when that file exists**. Use the explicit development-launch command above when working on the source build.

## Controls and PC options

The mouse cursor hides over the active game window. It returns when you Alt-Tab away, open F11 options, or see the quit prompt.

Click the game window before using the keyboard. A virtual controller occupies player one's port and merges keyboard input with SDL gamepad input. Keyboard input releases when the window loses focus.

A lone controller automatically shares player 1. With multiple controllers, press START on each in the desired player order. Open **F11 → Controllers** or **F11 → Keyboard** to see detected controllers and change their ports. For keyboard and controller co-op, leave the keyboard on player 1 and select player 2 for the controller. Assignments last for the current connection.

| Keyboard | Xbox input |
| --- | --- |
| Enter | Start / pause |
| Arrow keys | D-pad / menus |
| Space or Z | A / confirm |
| Backspace, Escape, or X | B / back |
| WASD | Left stick / movement |
| IJKL | Right stick |
| C / V | X / Y |
| Q / E | Left / right trigger |
| 1 / 2 | Black / white |
| Tab | Back button |
| F / R | Left / right stick click |

**F11** opens PC options for display mode, output resolution, render scale, anisotropic filtering, VSync, frame cap, keyboard bindings, controller settings, and cheats. Save settings to persist them. The options panel releases game input but does not pause simulation; pause with Enter beforehand if desired. F3 and F11 are reserved keys.

The launcher and F11 Graphics tab offer **Skip boot videos**, off by default. Escape on the main menu opens a quit confirmation; it keeps its Back behavior elsewhere.

Temporary cheats start disabled each launch. Permanent cheat actions and resulting world changes can affect saved progress; see the in-game labels and [native notes](docs/NATIVE.md).

## Create a portable package

After completing a full developer build:

```powershell
node tools/package-release.mjs
node tools/check-release.mjs release
```

The default destination is `release/`. To create another package, choose a new destination:

```powershell
node tools/package-release.mjs 'C:\path\to\Heroes-PC-clean'
node tools/check-release.mjs 'C:\path\to\Heroes-PC-clean'
```

The packager refuses to overwrite an existing destination. It includes the host, launcher, compiler, extraction runtime, configuration, runtime libraries, and license notices. Package creation may need internet access to retrieve matching Node.js notices; player preparation runs offline.

Packages exclude the ISO, imported game files, generated gameplay C++, `Heroes.dll`, saves, settings, and private compiler work. **Distribute only a fresh verified package**, never a folder after game preparation or the CMake developer output. See [packaging details](docs/PACKAGING.md).

Before sharing a source archive, run `npm run release:check` in a clean source copy. It checks actual files, including ignored content, so it is expected to reject a working checkout containing private imports, dependencies, or build output. `.gitignore` alone does not make a folder safe to distribute.

## Verification and troubleshooting

Run the default parser and native-migration checks:

```powershell
npm test
```

Additional focused regression checks:

```powershell
node --test tests/audio-notifications.test.mjs tests/keyboard-input.test.mjs tests/volume-geometry.test.mjs tests/current-diffuse.test.mjs tests/launcher.test.mjs tests/frame-pacing.test.mjs tests/cheats.test.mjs
```

Private-image graphics integration checks require your verified import and the npm analysis dependency:

```powershell
$env:HEROES_TEST_GAME = '1'
node --test tests/native-graphics.integration.test.mjs
Remove-Item Env:HEROES_TEST_GAME
```

For development diagnostics:

```powershell
.\tools\run-native.ps1 -Diagnostics -Performance
.\tools\smoke-native.ps1 -Seconds 60
```

Run these separately and close the interactive game before starting another instance. The smoke test intentionally stops the game at its deadline and reports a timeout as failure; a timeout alone does not establish a crash. Developer game logs are under `native/out/build/release/logs/`, with smoke reports under `local/native-analysis/`.

| Problem | What to check |
| --- | --- |
| Unsupported executable | Confirm your own ISO matches a configured USA, Europe, France, Italy, or Spain build; inspect it with `tools/heroes.mjs inspect`. |
| Missing MSVC, Clang, CMake, or Ninja | Install the C++ workload and LLVM/CMake components listed above. The wrapper discovers Visual Studio through `vswhere.exe`. |
| MinGW compiler not found | Install MinGW-w64 or set `HEROES_CXX`; ensure `gcc.exe` is alongside `g++.exe`. |
| Dependency download fails | Check network access and rerun `tools/setup-native-deps.mjs`; existing pinned downloads are reused. |
| `local/game` already exists | Reuse the verified import. To import afresh, move the old import aside deliberately first. |
| Play stays disabled | Read the preparation log, fix the reported error, and retry Prepare game. |
| Keyboard does not respond | Focus the game window, then use Enter, arrows, and Space for menus. |

## Project layout and further reading

| Path | Contents |
| --- | --- |
| `native/` | Active C++ host integration, launcher, CMake project, and game profiles |
| `tools/` | ISO/XBE inspection, import, build, preparation, and packaging scripts |
| `config/` | Supported executable fingerprint |
| `tests/` | Parser, policy, host behavior, and integration checks |
| `third_party/xboxdecomp/` | Content-pinned SDK source with licenses and maintained patches |
| `research/js-prototype/` | Archived JavaScript prototype and historical tests |
| `local/`, `native/assets/`, `native/generated/`, `native/out/` | Ignored imports, dependencies, analysis, and build output |
| `release/` | Ignored portable package output |

- [Native integration and technical history](docs/NATIVE.md)
- [Portable packaging](docs/PACKAGING.md)
- [Launcher and front-end behavior](docs/FRONT-END.md)
- [Gameplay defect tracking](docs/GAMEPLAY-BUGS.md)
- [Animation experiment](docs/ANIMATION-60FPS.md)
- [Roadmap](docs/ROADMAP.md)
- [Third-party provenance and patches](third_party/README.md)

Some technical documents retain historical checkpoints. For package creation, follow the current packaging guide above and `docs/PACKAGING.md`.

Keep the bundled third-party licenses and notices with distributed source and packages. Original game content remains separate and must be supplied by each player.
