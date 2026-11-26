# Investigation: animation at 60 FPS

Investigated November 23, 2026 against the fingerprint-verified USA import. The findings below came from static code and asset inspection. An opt-in runtime experiment has since been added, described below; it is not yet a confirmed fix for the reported animation cadence.

## Agreed scope

The user clarified the target after this investigation: make skeletal character animation visually smooth at 60 FPS while preserving original animation durations and gameplay speeds. Movement, attacks, spell timing, root motion and animation events must retain their intended timing. Keep pre-rendered videos at their original frame rates. UI animation improvements are deferred. The other animation systems described below are investigation context, not part of the first implementation.

## Findings

The renderer already reaches approximately 60 presented frames/second in the previously tested crypt gameplay (see NATIVE.md). That counter cannot establish whether characters receive a new pose on every frame.

The skeletal animation engine already supports interpolation. The retail `vkJointAnimation` implementation is identified by its class registration and vtable at `0x2A0960`:

| Address | Observed behavior | Implication |
| --- | --- | --- |
| `0x98F90` | Finds surrounding translation keys using floating-point key times; computes `(time - previousTime) / (nextTime - previousTime)` and calls `0x791A0`. | Translation can be evaluated between authored keys. |
| `0x791A0` | Computes the three components of `a + (b - a) * fraction`. | Existing vector interpolation; duplicating/resampling assets is not the first requirement. |
| `0x99150` / `0x98BE0` / `0x98850` | Finds rotation keys, decompresses them and interpolates quaternions, including sign correction and trigonometric weights. | Existing rotation interpolation as well. |
| `0x998B0` (vtable slot `+0x64`) | Advances animation time using a supplied delta, playback direction and speed; also computes translation deltas. Rejects repeat advancement with the same render-context stamp. | Calling it twice can be ineffective or alter root movement; understand the stamp and call order first. |
| `0x99C50` (slot `+0x5C`) | Samples rotation and translation tracks at the animation's current sample time. | A useful point to measure actual pose sampling frequency. |

Imported packs contain `.vkanim` resources explicitly identifying `vkJointAnimation`, including wizard combat-idle and spider idle/attack clips. The loader at `0x9A0A0` reads per-joint tracks; `0x99FA0` and `0x9A010` load floating-point key times. These findings do **not** establish the authored sample rate of every clip, but they show that low key density alone need not force a low display cadence.

## A concrete alternate-frame candidate

The model update routine at `0xB0F40` contains an explicit conditional update skip:

1. At `0xB111E`, read global byte `0x49D094`.
2. When enabled, combine the object's byte at `+0xEA` with the render context's counter at `+0x0C` and test bit zero.
3. On selected frames, accumulate the global delta (`0x49C160`) in object `+0x110`, then return at `0xB115E`.
4. Otherwise, combine the current delta and accumulated delta at `0xB116C`, clear the accumulator, and run child-model updates through `0xA7E80` at `0xB11EC`.

This can produce alternate-frame model updates while preserving elapsed animation time: a plausible explanation for 30 Hz poses on 60 Hz presentation. **It is not a confirmed active cause.** The imported image's initial global byte is zero, and the raw image contains only the read's direct reference to that address. An indirect runtime write remains possible. Measure the live byte and branch counts before changing it; disabling an already-disabled branch achieves nothing.

There are also per-context duplicate-update guards at `0xB0F53` and `0x998B0`. They prevent repeated updates within one context and must not simply be removed. A stale/shared context counter or another caller's scheduling could limit updates even with alternate-frame skipping disabled.

Global elapsed time is calculated at `0x67470` and `0x68390`, stored at `0x49C160`, and consumed by multiple systems. Another update accumulator at `0x118A10` subtracts approximately 16.675 ms (`0x2A9700`), so the code does not support assuming a universal 30 Hz simulation lock.

## Other animation types

- **Sprite/UI frame sequences:** `0x81E40` initializes a sequence interval to `1/30` second. `0x82400` supports elapsed-time and update-count scheduling, returning an integer frame index. Its direct callers include `0x73B93` and `0x208605`. This is a separate system from skeletal interpolation. A 30-frame sequence intended to last one second still needs intermediate visual frames or blending to look smoothly 60 Hz; halving its interval would shorten its duration.
- **Pre-rendered videos:** all 62 imported `.bik` files were inspected. Their header frame-rate numerator/denominator fields declare 34 at 30 FPS, 27 at 29.97 FPS, and one at approximately 30.337 FPS. Presenting them at 60 Hz repeats source frames. New intermediate images or replacement video would be required for new motion on every output frame while retaining duration and audio synchronization.
- **Particles, camera movement and material effects:** not exhaustively traced in this pass. They require separate cadence checks; skeletal fixes cannot promise to cover them.

## Recommended implementation sequence

1. Add opt-in, title-thread diagnostics using the existing present hook at `0x69410` as the output-frame reference. For a selected visible hero and enemy, count model-update entry, duplicate-context returns, alternate-frame returns, animation advancement and pose sampling. Record context stamps, `0x49D094`, supplied delta, accumulated delta and animation time. Compare selected bone transforms across frames during a moving animation; an idle pose alone is insufficient evidence. Aggregate output rather than logging every joint.
2. If alternate-frame skipping is active, add a fingerprint-specific experimental hook that bypasses that skip. Verify elapsed-time accumulation and sample frequency. If it is inactive, trace the call chain into `0xA7E80` and animation slots `+0x64`/`+0x5C` to find where poses are held or updates are omitted.
3. Prefer evaluating the existing interpolated skeletal tracks once per presented frame with the correct elapsed time. Keep clip duration, root displacement, blending and loop boundaries intact. If pose updates are coupled to lower-rate gameplay logic, separate visual pose evaluation from event/gameplay advancement rather than doubling both.
4. Check attack hit windows, combo timing, spell/projectile spawning, footsteps, sound events, attachments, movement distance and cutscene timing. Animation-event strings in the image explicitly include hit, spawn, attach/detach and sound messages, so additional evaluation must not emit these twice.
5. Measure CPU/GPU cost with crowds and co-op, and compare stationary-camera captures at 60 Hz. More frequent bone evaluation or skinning may consume headroom even when the present counter remains at 60.
6. Defer UI animation changes. Keep videos at their original frame rates. Investigate other real-time effects separately if they still appear uneven after the skeletal fix.

The smallest promising first change is a measured skeletal update-cadence fix. A blanket change of constants from 30 to 60 would not address all these systems and could speed up authored sequences or gameplay events.

## Reproduction and limitations

### First runtime experiment

`native/src/common/animation_test.cpp` and the fingerprint-specific hook configuration now provide three launch modes. Default launches remain off:

```powershell
# Baseline: count the original model skips and animation sample intervals.
./tools/run-native.ps1 -AnimationTest Observe

# Experiment: bypass the optional alternate-frame return at B111E only.
./tools/run-native.ps1 -AnimationTest Full

# Original behavior without cadence diagnostics.
./tools/run-native.ps1
```

Close the game between modes and compare the same scene/actions. The mode is a process environment setting, not a saved game option. The launcher script restores its caller's environment after starting the game. Test near the 60 FPS cap. Videos and UI scheduling are unchanged in all modes.

The report in `native/out/build/release/logs/heroes.log` appears every 120 calls to the existing gameplay present wrapper. It includes model entry, gate, alternate-frame candidate/return, model-step, animation advance and joint-sample counts. Up to four animation objects report the number of presented-frame intervals in which they were sampled and their sample time changed. Joint calls within one interval are deduplicated. These are thread-local, bounded diagnostic counters; object keys are discarded every report and never dereferenced later. More than 128 animation objects are reported as untracked samples. Animation objects are not yet labeled by hero or enemy, and a changed sample time does not prove the final bone matrices changed. Counts describe the presenting thread, not other guest threads.

Use `alternate_candidates` and `skipped` to test the original hypothesis. If Observe records candidates/skips and Full eliminates the skips, compare sampled/changed-time frames and visual motion. If both record zero candidates, this experiment is expected to have no visual effect: it has ruled out this skip for that scene, and tracing the next scheduling layer is required. A stationary animation can legitimately have unchanged sample times.

Full mode preserves the native accumulated-delta arithmetic, duplicate-context guards, root-motion calculation and event processing code. It does not insert a second animation tick or change a clock constant. Gameplay testing must still verify that more frequent model updates preserve event behavior, movement distance and clip duration. This is an experimental bypass for model updates, which may include animated scene props as well as characters, not a production claim that every animation is now 60 FPS.

The dedicated checks run with:

```powershell
$env:HEROES_TEST_GAME='1'
node --test tests/animation.test.mjs
```

They exercise the actual host hooks against synthetic guest memory in off/observe/full/invalid modes, check that guest memory and CPU state remain untouched, validate pose-count deduplication/reset, and verify hook boundaries/accumulation/context guards against the user's verified executable.

### Initial validation

The native build succeeded and all 56 active checks passed with `HEROES_TEST_GAME=1`, including both new animation checks. A bounded 45-second Full-mode startup run stayed alive until the smoke tool intentionally stopped its own process (timeout exit 2, not a clean game exit). Its later intervals recorded 120 presents in approximately two seconds and joint sampling on every interval for several tracked animations; some moving intervals had 119 changed-time frames out of 120. Other intervals held sample time, which alone does not diagnose a defect without knowing the scene and animation state. No visual gameplay comparison or speed validation was performed.

All reported alternate-frame candidate and skip counts were zero in this startup run. Consequently it does not demonstrate that the bypass improves animation. Gameplay Observe/Full comparison remains required, and may direct the next patch toward another scheduling layer. The preserved private startup log is `local/native-analysis/animation-full-startup.log`; build and regression logs are `native-build-animation-final.log` and `animation-regression.log` in the same directory.

Private helpers under `local/native-analysis/` were used to inspect the verified image, decode original instructions, inspect pack tables and read video headers: `investigate-animation.mjs`, `animation-xrefs.mjs`, `animation-assets.mjs`, `animation-rates.mjs`, and the existing `dump-cheat-code.mjs`. These and imported assets remain private. Pack parsers checked that declared entry sizes consumed the complete inspected packs.

No runtime pose capture or complete animation asset census was performed during the initial investigation. The experiment requires gameplay comparison before deciding whether this is the active cause or a useful final fix. The investigation identifies implementation targets and separates confirmed mechanisms from the unconfirmed cause of the reported visual cadence.
