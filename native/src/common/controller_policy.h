#pragma once
#include <algorithm>
#include <cmath>
#include "core/input.h"
namespace heroes {
inline void FilterStick(int16_t& x,int16_t& y,uint32_t percent) {
    float length=std::sqrt(float(x)*x+float(y)*y), dz=32767.0f*std::min(percent,40u)/100.0f;
    if(length<=dz){x=y=0;return;}
    float scale=(std::min(length,32767.0f)-dz)/(32767.0f-dz)*32767.0f/length;
    x=int16_t(std::clamp(float(x)*scale,-32767.0f,32767.0f));
    y=int16_t(std::clamp(float(y)*scale,-32767.0f,32767.0f));
}
inline void FilterController(input::Pad& pad,uint32_t deadzone) {
    FilterStick(pad.lx,pad.ly,deadzone);FilterStick(pad.rx,pad.ry,deadzone);
}
}
