# Gameplay compatibility investigation

The user has confirmed hero selection, the opening cinematic, movement, melee combat and spellcasting, and subsequently reported that the earlier visible defects appear corrected. The current reported rendering defect is the minimap. Loading an existing level-15 wizard save into Upper Crypts 2 was observed during PC-options testing; a controlled new-save/restart/load round trip still needs validation.

## First rendering and storage corrections

Five reviewed XDK 5455 functions now use existing SDK host implementations: `SetRenderTarget` (0x241290), `SetRenderState_ZEnable` (0x244FA0), `StencilEnable` (0x245030), `TextureFactor` (0x244210) and `PSTextureModes` (0x243D20). Their argument cleanup, target fields and render-state writes are checked against the user's fingerprint-verified image. The old guest implementations changed guest tables or GPU commands without updating the corresponding host state. Deferred synchronization covers states 92–135, so it did not repair these complex states (136 and above).

After this batch the user confirmed that repeated H characters on hero selection disappeared and water effects were corrected. The wizard staff was still invisible after that first batch (corrected in the next batch below). Because these five mappings were tested together, the individual mapping responsible for each improvement has not been isolated.

The volume service previously claimed 16 GiB capacity and 8 GiB available. Heroes' save wrapper at 0x214770 takes only the low 32 bits of the byte counts returned by `GetDiskFreeSpaceExA` (0x58638), then shifts them by 14 to obtain blocks. Both previous values wrapped to zero. The maintained kernel patch reports 16 KiB allocation units bounded by actual host capacity/available space, capped at 0xFFFFC000 bytes to keep title arithmetic within 32 bits. It also checks volume handles and output lengths. Unit tests cover large disks, low/full disks, rounding and inconsistent inputs. Options-save files were observed under the emulated hard drive after testing. A successful game save followed by loading it remains required; correcting a space query alone does not prove save persistence.

## Equipment material correction

The user observed that the invisible staff is present in its shadow, pointing to the visible pass rather than an absent mesh. A local GPU capture also shows equipment draws using FVF 0x112 and the weapon texture atlas. Their fixed-function vertex shader reads diffuse alpha from `mat[0]`; its pixel shader multiplies texture alpha by that value and performs alpha testing. The host material remains zero-initialized because `SetMaterial` was unmapped.

Three further reviewed mappings connect `SetMaterial` (0x241080), `SetLight` (0x241B00) and `LightEnable` (0x241DC0). The material setter copies 17 dwords; light data copies 26 dwords. The existing SDK light wrappers retain the original guest light-list management while copying the state for the host renderer. The private-image regression checks these record sizes, argument cleanup, a title material call and the light-enable default-light call. The user confirmed that the wizard staff is visible after this second batch. Ground pickups were subsequently confirmed visible; thrown items still need a separate retest.

## Reported defects and status

| Report | Status / next evidence |
| --- | --- |
| 1. No blocks to save | Confirmed overflow corrected; in-game save and reload still need validation. |
| 2. Overlapping or incorrectly visible text | Depth/stencil and target state corrected; retest remaining locations. |
| 3. Black borders / square seams on floors and walls | User confirmed surfaces look correct after texture-coordinate selection and surface-copy mappings. Other untested effects remain separate. |
| 4. Invisible wizard staff | User confirmed fixed after material/light mappings in the second batch. |
| 5. Repeated H characters at hero selection | User confirmed fixed after first batch. |
| 6. White water/puddles | User confirmed water effects fixed after first batch. |
| 7. Invisible pickups and thrown items | User confirmed ground pickups are now visible. Thrown-item visibility still needs a separate retest. |
| 8. White box at spellcasting hand | Open; retest alpha, texture and combiner state in a captured spell frame. |
| 9. Join prompts in all HUD corners | Open. Preserve title behavior until player-slot conditions and an original reference establish the intended display. |
| 10. Invisible settings selection | Open; inspect highlight draw/texture/depth state. |
| 11. Apparent wrong font | User confirmed fonts and font colors fixed after reopening with the material/light correction. The game uses its original font files. |

## Capturing remaining failures

Run `./tools/run-native.ps1 -Capture` for verbose diagnostics and local GPU capture. F3 captures one frame through the existing SDK renderer and dumps thread diagnostics. Captures go under ignored `local/native-analysis/gpu-captures`; they contain game-derived images and shader information and must remain private. Capture remaining symptoms, such as a spell artifact, a floating damage number or the settings highlight, separately. Compare submitted draws, texture bindings, alpha/depth state and shader inputs before changing game asset loading or hiding text.

An additional SDK limitation was found during inspection: immediate-mode XYZRHW vertices are converted to a synthetic shader declaration, losing their screen-space classification. It has not been changed in this batch or proven to cause a remaining Heroes symptom. Likewise, unmapped functions are candidates for review, not evidence that the game calls them or that mapping them will fix equipment.

## World texture seam investigation

The user narrowed the remaining squares and black borders to floors and walls. The SDK automatic wrap-to-clamp workaround was applied to every small raw draw with UVs in 0..1, including 3D world surfaces. This could change edge filtering even when the title requested wrapping. A diagnostic build restricted that workaround to screen-space draws, but the user reported no noticeable improvement. The change was reverted; it is not counted as a seam fix. The latest capture shows large dark polygon boundaries and a pedestal/memorial with visibly corrupted texture data. Its captured texture image has intact rows followed by colored garbage, while another pedestal atlas is intact. This establishes a texture-data/binding problem for at least that object, independently of possible geometry defects.

The title texture-coordinate selector at 0x2445C0 was also reviewed and mapped: it writes deferred state 28 at stage stride 128 bytes and supports coordinate-generation bits. The SDK otherwise synchronizes only states 0..21. A private-image check verifies the title call, table write, stride and ret 8. The user confirmed that walls appeared fixed after this mapping. The pedestal still had corrupted textures.

Opt-in captures now include raw float position/normal/UV values for small native-buffer draws, fixed-function transforms and texture addressing/filter/coordinate selection. Capture-enabled launches also report skipped inline texture-address/format commands. The profile now has 107 mappings and the active suite passes 43 checks.

### Pedestal texture data

The capture includes `tex_81BC2000.bin`, a 43,680-byte DXT1 mip chain. Its first 11,552 bytes match the tail of GroundSkel.bmp in CHSELECT.PAK/CAVE4.PAK, then it runs into non-image memory. Its start corresponds to offset 32,286 in that serialized asset, rather than the start of its pixels. Another sampled pedestal atlas matches its source data completely. This is evidence of an uninitialized or incorrectly addressed texture, not proof that source disc content is damaged.

`CopyRects` (0x241560) was unmapped and emitted console GPU blits. It now uses the existing host implementation. Reviewed title uses include an image-clone path at 0x657F7, a linear image-copy path at 0x650A5 and framebuffer-to-texture copy at 0x1044D9. The private-image regression validates source/destination handling, blit method and five-argument cleanup. The user confirmed that the pedestal looks correct after this mapping, then confirmed that the originally reported floor/wall seams and black borders are also corrected. The distorted appearance was addressed through rendering state/data copies; no game mesh or texture asset was replaced.

## Floating damage-number color

The user confirmed ground pickups are visible, but reported damage digits drawn white with a duplicate. Private capture 222636 shows the same glyph in two offset world-space quads (draws 1831 and 1832), using a declaration with position, normal and UV but no diffuse input. The generated fixed-function shader hardcodes `oD0 = float4(1,1,1,1)` for both. The engine sets a constant diffuse attribute separately: 0x97D1B selects attribute 3 and 0x97D1D calls the four-byte setter before array drawing. The old runtime retained those values only in immediate-mode storage and did not supply them to array draws.

The maintained renderer patch now records current diffuse in host GPU state, transfers it through the existing render-thread state ranges and draw constants, and uses it for a missing diffuse input in fixed-function unlit or programmable vertex shaders. Explicit vertex colors still override it. Captures log the current diffuse to distinguish the glyph and shadow passes. The native shader-generator regression covers streamed/constant colors in screen/world fixed-function paths and a synthetic programmable MOV; private-image evidence checks the title constant-color call. Build and all 43 checks pass. The user confirmed that the numbers and shadow now look correct.

## Minimap palette and PC options

Private frame 003210 shows the circular map at draw 1334 using a 256x256 P8 indexed texture, followed by a separate overlay. Its texture dump shows gray/white areas. The SDK supports stage palettes, but Heroes' `SetPalette` was unmapped, leaving the host palette state empty. The reviewed setter at 0x2420D0 reads stage/palette arguments, manages resource references, stores at CDevice+0xB78+stage*4, emits palette method 0x41B20 and returns with ret 8. Title calls at 0x63BAF and 0x653AD confirm use. The profile now maps this setter and supplies the palette-array offset to the existing SDK wrapper. A private-image regression checks these facts. This is a candidate correction pending the user's minimap retest; fog-of-war behavior has not yet been confirmed fixed.

The active profile has 108 function mappings, 10 data mappings and 37 reviewed layout facts. All 47 active checks pass with the private-image checks enabled. F11 options and the FPS overlay were observed working; the user also confirmed F11. The native development launcher verified/reused the user's real ISO import and saved display settings. Controller paths include SDL hotplug, four ports, analog input, vibration and configurable deadzones; physical hardware remains untested.

An opt-in performance run (`./tools/run-native.ps1 -Capture -Performance`) measured roughly 40–48 FPS in this saved scene, versus about 60 at the menu. One sampled frame reported 20.81 ms total, 5.44 ms host renderer work and 15.37 ms outside that renderer accounting; title-thread readback waits were about 3.18 ms per frame. These figures identify further profiling work, not a completed performance fix. Supersampling increases GPU cost; lowering render scale may help GPU limits but cannot remove time spent executing title code or waiting for readbacks.
