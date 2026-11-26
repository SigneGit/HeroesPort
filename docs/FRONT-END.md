# Main menu and startup options

Escape on the main menu asks whether to close the game. No is the default.
Keyboard/controller input and vibration are released while the dialog is open.
Escape keeps its Back behavior in submenus and gameplay and still cancels key
rebinding in PC options. The window close button retains its usual behavior.

The launcher offers **Skip boot videos**, off by default. The same saved setting
is available in F11 Graphics; use Apply display and save, then restart the game.
It skips the legal, Atari, Wizards of the Coast and Bink startup videos. The
opening story cinematic, later cutscenes and attract video are unaffected.

## Reviewed supported-image facts

These hooks apply only to the USA fingerprint enforced by the importer.
No source game files are modified.

- Main menu object `0x322388` has vtable `0x29C764`: initialize `0x3C9F0`,
  hide `0x106750`, update `0x3CAD0`, input `0x3D200`, draw `0x3CC40`. Initialization loads
  `Data\Menu\Menu.gux`. The active byte is object offset 5.
- The screen stack at `0x499500` has 16 entries of 8 bytes and its count at
  offset `0x80`. `0x3D690` pushes a screen; `0x3D4F0` pops/truncates it.
  Main-menu updates publish an atomic host snapshot only when that object is
  active and no other screen is above it. Hiding the menu, opening another
  screen or entering a movie clears the snapshot. The window thread reads
  only host atomics, never guest object memory.
- The startup procedure `0xC4860` calls movie playback `0xC46E0` with return
  sites `0xC49A5`, `0xC4A01`, `0xC4A2B`, `0xC4A55`. At `0xC46E7`, the three
  callee-saved registers have been pushed, ESI holds the movie owner and EDI
  is zero. The skip hook checks the saved return address at ESP+12, clears
  the owner's playing byte at `+0x170`, then resumes the original epilogue
  at `0xC484E`, which returns zero, restores registers and cleans two arguments.
  Other callers retain their complete native playback path.

Synthetic native tests exercise menu/submenu gating, invalid state, disabled
skipping, all four boot callers, story/attract exclusions and register/memory
preservation. `HEROES_TEST_GAME=1 node --test tests/front-end.test.mjs` also
checks mappings against the user's fingerprint-verified executable.
