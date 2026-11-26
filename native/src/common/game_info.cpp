#include "app/app.h"
#include "kernel/kernel.h"
#include "player_options.h"
void HeroesKeyboardPad(int port,input::Pad& pad);

namespace {
void Loaded() {
    // The host mounts the user's imported files on private virtual storage.
    // Change the loaded certificate's media policy only; never change the XBE file.
    const uint32_t certificate = kernel::R32(0x00010118);
    kernel::W32(certificate + 0x9c, 1);
    kernel::W32(certificate + 0x1d8, kernel::R32(certificate + 0x1d8) & ~1u);
}
}
const app::GameInfo app::kGame = {
    .title = L"Dungeons & Dragons: Heroes",
    .short_title = L"D&D Heroes",
    .name = L"DDHeroes",
    .log = "heroes",
    .settings = "heroes-settings.toml",
    .splash = L"heroes-splash",
    .missing = L"Provide your legally acquired D&D Heroes Xbox image or its verified imported files in assets.",
    .images = {{"default.xbe", "Heroes"}},
    .options = {{"show_fps",&heroes::show_fps,nullptr},{"controller_rumble",&heroes::rumble_enabled,nullptr},
                {"stick_deadzone_percent",nullptr,&heroes::deadzone_percent}},
    .load = heroes::LoadOptions,
    .save = heroes::SaveOptions,
    .init = nullptr,
    .loaded = Loaded,
    .window = heroes::InitializeCursor,
    .message = heroes::WindowMessage,
    .ui = heroes::DrawOptions,
    .pad = HeroesKeyboardPad,
    .rumble = heroes::Rumble,
};
