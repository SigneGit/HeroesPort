# Portable Windows release

The distribution folder is `release/` at the repository root. The similarly
named `native/out/build/release/` remains CMake's private developer output.
Do not distribute the CMake directory directly.

Build the host once in a developer checkout using the supported private import,
then run `node tools/package-release.mjs`. An optional destination argument
creates another package. Existing destinations are never overwritten, because
they may contain a player's assets and saves.

Pass `--zip` to also create `Heroes-PC-v<version>-Windows-x64.zip` beside the
destination. The version comes from `package.json`. The archive contains the
verified package with `recomplauncher.json` beside `Heroes.exe`. Attach that
archive to the corresponding versioned release with a summary of the changes.

Easy Setup invokes `Heroes.exe --prepare "--game=<path>"`. For an extracted
folder, the importer compares its inventory to the supported USA import.
The fingerprint in `config/supported-build.json` hashes the UTF-8 JSON array
of [lowercase relative path with forward slashes, byte size, SHA-256] entries
sorted by path. A later `Heroes.exe --prepare` reuses the installed assets.
Play runs the same executable with no arguments.

The launcher's full-disc size and CRC32 come from the [USA entry in Redump's
Xbox datafile](https://data.spludlow.co.uk/redump/redump/Microsoft%20-%20Xbox/Dungeons%20%26%20Dragons%20-%20Heroes%20%28USA%29).
Trimmed XISOs still use the importer's executable fingerprint check.

The package contains HeroesLauncher.exe, the host Heroes.exe, the Node runtime,
the verified XDVDFS extractor, Clang, LLD, the native recompiler, host export
library, configs, freestanding compilation headers, Microsoft release runtime
DLLs, and third-party license notices. Node notices are fetched once from the
official source tag matching the bundled runtime version. Only package creation
needs that network access; player preparation runs offline.

The SDK runtime already supports loading player-generated gameplay code. The
portable helper uses the same recompiler, compiler target/flags, freestanding
headers and linker flags, so player machines need no Microsoft SDK or native
build-tool installation. It checks every imported file's size and SHA-256 before
preparation. Extraction uses a fresh staging directory inside the release and
atomically installs `assets/` only after successful completion. No junctions or
absolute asset links are created.

All generated sources, objects and intermediate files belong to
`compiler/work/Heroes`. The completed gameplay DLL belongs beside Heroes.exe.
The readiness marker is removed before preparation and written only after
success. A failed preparation leaves Play disabled and retains imports/saves.
Runtime saves, settings and logs use paths relative to the executable as before.

`node tools/check-release.mjs release` validates the complete pre-import package
against its inventory and rejects game assets, gameplay DLLs, compiler work,
private directories, links, missing files or unexpected changes. The packager
also runs it before installing the finished folder. A package after extraction
must not be redistributed; generate a fresh package from the developer build.

The package does not copy an ISO, imported files, generated gameplay C++,
Heroes.dll, saves, settings, compiler work, a source checkout or developer logs.
The importer never alters the supplied ISO. Windows x64 and a DirectX 12 capable
system remain runtime requirements.
