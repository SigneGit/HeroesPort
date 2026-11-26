# Active native port roadmap

## Migration foundation

Implemented: verified own-disc import, content-pinned XboxDecomp SDK, original license/notices, maintained scanner evidence patch, portable native tool builds, Heroes host registration and CMake integration, conservative symbol/data mapping, and private native C++ generation.

The previous JavaScript runtime is archived under `research/js-prototype`. Its 260,000-instruction startup checkpoint and tests remain research evidence, not the active game's execution backend. New runtime work should use the SDK's existing services instead of extending that parallel implementation.

## Native build and startup

Completed: the Windows host and generated-code build, followed by bounded native diagnostic launches. Execution now initializes Direct3D 12, audio output and the sound-effects image. Continue replacing hardware-facing resource/synchronization calls and investigating executed paths. Keep the ISO requirement and source fingerprint validation in the normal build flow.

The initial controller mappings include the SDK's `XInitDevices` and `XInput*` replacements. That creates a path around the original low-level USB initialization, but actual controller behavior remains to be tested in the native game.

## XDK 5455 integration

The supplied SDK's complete signature profiles do not cover 5455. Compare multiple references conservatively, prove ABI contracts, and record layout facts from Heroes itself. The profile enables 107 functions, ten data entries and 36 reviewed layout fields; conflicting or heuristic-only matches remain zero.

Device creation, principal device/global state tables, controller fields, refresh events and effects-image offsets are now identified. Continue validating shader objects, DirectSound streams and remaining host replacements. Copying another version's layout is not a substitute for validation.

## First frame and gameplay

Intro movies and the animated menu render; the user confirmed corrected menu graphics and functioning audio after draw/clear replacements. Keyboard controls now map to a player-one controller. The user has confirmed hero selection, the opening cinematic, movement, combat and spells. Investigate the reported save-space and rendering defects next; track evidence and retests in [GAMEPLAY-BUGS.md](GAMEPLAY-BUGS.md), followed by co-op, audio fidelity and frame pacing. Keep Heroes-specific fixes isolated in host hooks/configuration.

## Distribution

Create an explicit package allowlist containing the project's host runtime, licensed dependencies and generic tools. Perform game-derived translation on the player's machine from a verified supplied image. Do not publish generated gameplay code or binaries, original game files, SDK binaries that lack redistribution permission, or private captures. Establish supported hardware and compatibility limits through actual gameplay testing.
