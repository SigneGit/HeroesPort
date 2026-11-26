#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <SDL3/SDL.h>
#include "app/app.h"
#include "core/input.h"
#include "core/log.h"
#include "keyboard_pad.h"

namespace {
heroes::KeyboardPadState keys;
void Keyboard(int port, input::Pad& pad) {
    heroes::ApplyKeyboardPad(port, true, keys, pad);
}
void Update() {
    SDL_Delay(2);
    input::Controllers();
}
SDL_JoystickID Attach(Uint16* motor = nullptr) {
    SDL_VirtualJoystickDesc desc{};
    SDL_INIT_INTERFACE(&desc);
    desc.type = SDL_JOYSTICK_TYPE_GAMEPAD;
    desc.vendor_id = 0xface;
    desc.product_id = 0xc001;
    desc.nbuttons = SDL_GAMEPAD_BUTTON_COUNT;
    desc.naxes = SDL_GAMEPAD_AXIS_COUNT;
    desc.name = "Co-op test pad";
    desc.userdata = motor;
    desc.Rumble = [](void* userdata, Uint16 left, Uint16) {
        if (userdata) *static_cast<Uint16*>(userdata) = left;
        return true;
    };
    auto id = SDL_AttachVirtualJoystick(&desc);
    assert(id);
    Update();
    return id;
}
void Button(SDL_JoystickID id, SDL_GamepadButton button, bool down) {
    assert(SDL_SetJoystickVirtualButton(SDL_GetJoystickFromID(id), button, down));
    SDL_UpdateJoysticks();
    Update();
}
void Start(SDL_JoystickID id) {
    Button(id, SDL_GAMEPAD_BUTTON_START, true);
    Button(id, SDL_GAMEPAD_BUTTON_START, false);
}
}
const app::GameInfo app::kGame{.pad = Keyboard};
void logx::Write(Level, const char*, ...) {}

int main() {
    SDL_SetHint(SDL_HINT_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT, "0xface/0xc001");
    input::Init();
    auto a = Attach();
    assert(input::Controllers().size() == 1 && input::Controllers().front().port == 0);
    keys.analog[0] = true;
    Button(a, SDL_GAMEPAD_BUTTON_EAST, true);
    assert(input::Poll(0).analog[0] && input::Poll(0).analog[1]);
    input::AssignController(a, 3);
    assert(input::Poll(0).analog[0] && !input::Poll(0).analog[1]);
    assert(!input::Poll(3).analog[0] && input::Poll(3).analog[1]);
    assert(SDL_DetachVirtualJoystick(a));
    Update();
    assert(!input::Poll(3).connected);
    a = Attach();
    Uint16 motor = 0;
    auto b = Attach(&motor), c = Attach(), d = Attach(), extra = Attach();
    for (auto& controller : input::Controllers()) assert(controller.port == -1);
    Start(c);
    Start(a);
    Start(d);
    Start(b);
    Start(extra);
    auto devices = input::Controllers();
    assert(devices.size() == 5);
    assert(devices[0].port == 1 && devices[1].port == 3 && devices[2].port == 0);
    assert(devices[3].port == 2 && devices[4].port == -1);
    for (int port = 0; port < 4; ++port) {
        assert(input::Poll(port).connected);
        assert(input::Poll(port, true).buttons & 16);
        assert(!(input::Poll(port, true).buttons & 16));
    }
    input::Rumble(3, 1000, 0);
    assert(motor == 1000);
    input::AssignController(a, 3);
    assert(!motor);
    input::Rumble(1, 2000, 0);
    assert(motor == 2000);
    Button(b, SDL_GAMEPAD_BUTTON_NORTH, true);
    assert(input::Poll(1).analog[3] && !input::Poll(3).analog[3]);
    assert(SDL_DetachVirtualJoystick(b));
    Update();
    assert(!input::Poll(1).connected);
    Start(extra);
    assert(input::Controllers().back().port == 1);
    SDL_Quit();
}
