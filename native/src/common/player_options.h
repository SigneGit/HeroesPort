#pragma once
#include <atomic>
#include <cstdint>
#include "core/input.h"
namespace heroes {
inline std::atomic<bool> menu_open{false};
inline bool show_fps = false, rumble_enabled = true;
inline uint32_t deadzone_percent = 15;
inline uint32_t keys[24]{0x26,0x28,0x25,0x27,0x0D,0x09,'F','R',0x20,0x08,'C','V','1','2','Q','E',
                         'A','D','S','W','J','L','K','I'};
inline constexpr const char* key_labels[24]{"D-pad up","D-pad down","D-pad left","D-pad right","Start / pause","Back",
    "Left stick click","Right stick click","A / confirm","B / cancel","X","Y","Black / RB","White / LB","Left trigger","Right trigger",
    "Move left","Move right","Move down","Move up","Camera left","Camera right","Camera down","Camera up"};
void DrawOptions(double fps);
bool WindowMessage(void*,uint32_t,uintptr_t,intptr_t,intptr_t*);
void LoadOptions(const void*);
void SaveOptions(void*);
void Rumble(int,uint16_t&,uint16_t&);
}
