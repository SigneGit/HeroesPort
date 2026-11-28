#include "app/app.h"
#include "kernel/kernel.h"
#include "player_options.h"
#include "region.h"
void HeroesKeyboardPad(int port,input::Pad& pad);

namespace {
void Loaded() {
    heroes::pal_image = (kernel::R32(0x00010128) ^ 0xa8fc57abu) == 0x00055ce1;
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
    .releases = {
        {"default.xbe", "0bb472b7e78e98635b59e31a431b9167e223e035"}, // usa
        {"default.xbe", "edd86dc932836f76ab07bb69c9c1657977d5b791"}, // europe
        {"default.xbe", "caa8ee15199e8636b87e5d26affc3f0406b92f5d"}, // france
        {"default.xbe", "feebbc708a0cf75ad2f941dc63a7a0f5c8ed12c3"}, // italy
        {"default.xbe", "5a8f279b3d56443a53567d41afa1eac2c6e58c4b"}, // spain
    },
};
