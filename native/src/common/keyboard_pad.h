#pragma once
#include "core/input.h"

namespace heroes {
struct KeyboardPadState {
    bool digital[8] = {}; // dpad, start, back, left/right stick click
    bool analog[8] = {};  // A B X Y black white LT RT
    int lx=0,ly=0,rx=0,ry=0; // -1, 0, +1
};

inline void ApplyKeyboardPad(int port,bool focused,const KeyboardPadState& keys,input::Pad& pad) {
    if(port!=0)return;
    // Keep the virtual controller present across focus changes. Losing focus
    // releases keyboard input without disconnecting a player's controller.
    pad.connected=true;
    if(!focused)return;
    for(int i=0;i<8;++i) {
        if(keys.digital[i])pad.buttons|=uint16_t(1u<<i);
        if(keys.analog[i])pad.analog[i]=255;
    }
    if(keys.lx)pad.lx=int16_t(keys.lx*32767);
    if(keys.ly)pad.ly=int16_t(keys.ly*32767);
    if(keys.rx)pad.rx=int16_t(keys.rx*32767);
    if(keys.ry)pad.ry=int16_t(keys.ry*32767);
}
} // namespace heroes
