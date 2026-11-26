#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace input {

// the console controller's report, analog buttons are 0-255
struct Pad {
    bool connected = false;
    uint16_t buttons = 0;  // dpad up/down/left/right, start, back, left thumb, right thumb
    uint8_t analog[8] = {};  // A B X Y black white left trigger right trigger
    int16_t lx = 0, ly = 0, rx = 0, ry = 0;
};

void Init();  // window thread, before boot; the game code window starts it earlier
uint16_t HeldOnAnyController();  // face buttons as XINPUT_GAMEPAD_A/B/X/Y masks, GameInfo::pad left out
struct Controller {
    uint32_t id;
    std::string name;
    int port;  // zero based, -1 while waiting for Start
};
std::vector<Controller> Controllers();
void AssignController(uint32_t id, int port);
// Only a guest state read consumes the Start press that claimed a port.
Pad Poll(int port, bool read_state = false);
void Rumble(int port, uint16_t left, uint16_t right);

}  // namespace input
