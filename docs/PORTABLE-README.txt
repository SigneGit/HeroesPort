Dungeons & Dragons: Heroes - PC release v0.3.0

Extract the ENTIRE release folder to a writable location on a Windows x64 PC
with DirectX 12 support. Run HeroesLauncher.exe.

In RecompLauncher, enable Developer tools and add this folder as a local build.
Easy Setup accepts a supported Xbox ISO or its complete extracted game folder.
After preparation, Play starts Heroes.exe directly. The game's page includes
display and controller settings and can back up the title's saves.

Select your own legally obtained supported Xbox ISO and click Prepare game.
The launcher verifies the image, extracts its files, and prepares the game's code
using the tools included here. No Node.js installation, Visual Studio, MinGW,
source checkout, internet connection or additional compiler download is needed.
The initial preparation can take several minutes. Wait until Play is enabled.

Everything belongs in this folder:
  assets/                  Extracted game files (created after import)
  assets/.heroes-import.json  Import manifest and file hashes
  Heroes.dll               Gameplay code created locally from your game
  compiler/work/           Private generated code and compilation cache
  hdd/                     Game saves and virtual Xbox storage
  heroes-settings.toml     Launcher and PC options
  logs/                    Game and preparation logs
  runtime/                 Bundled extraction runtime
  compiler/                Bundled compiler and game configuration
  licenses/                Third-party licenses and notices

Keep this folder together. It can be moved after closing the game and launcher.
An imported game does not need the ISO connected for subsequent launches.
If preparation fails, see logs/prepare.log and retry Prepare game. Existing
imports and saves are retained. Incomplete or modified imports are rejected.

The launcher offers Skip boot videos (off by default). F11 opens PC options.
Enter is Start, arrows navigate, Space confirms, Backspace goes back, WASD moves.
Escape on the main menu asks whether to close; No is the default.

The downloadable release contains no original game data or gameplay DLL.
Do not redistribute this folder after importing your game: use a fresh package
made by the project's package-release tool, which excludes private game files.

Supported supplied retail versions: USA, Europe, France, Italy, and Spain.
Setup automatically selects the version from its executable and full inventory.
All four PAL versions passed main-menu startup checks. User testing found no
additional regional problems and confirmed RecompLauncher Easy Setup and Play.
Full-game, save/load and co-op coverage still need broader testing.
Temporary Windows extraction-folder locks are retried automatically.
