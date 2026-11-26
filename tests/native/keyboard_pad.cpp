#include "keyboard_pad.h"
#include "controller_policy.h"
#include <cassert>
int main() {
    heroes::KeyboardPadState keys;
    input::Pad pad;
    heroes::ApplyKeyboardPad(0,false,keys,pad);assert(pad.connected&&pad.buttons==0);
    pad={};heroes::ApplyKeyboardPad(1,true,keys,pad);assert(!pad.connected);
    keys.digital[4]=true;keys.digital[1]=true;keys.analog[0]=true;
    keys.lx=-1;keys.ly=1;keys.rx=1;keys.ry=-1;
    heroes::ApplyKeyboardPad(0,true,keys,pad);
    assert(pad.connected&&pad.buttons==0x12&&pad.analog[0]==255);
    assert(pad.lx==-32767&&pad.ly==32767&&pad.rx==32767&&pad.ry==-32767);
    pad={};heroes::ApplyKeyboardPad(0,false,keys,pad);
    assert(pad.connected&&pad.buttons==0&&pad.analog[0]==0&&pad.lx==0);
    // A physical controller's inputs remain available when keyboard keys are idle.
    pad.buttons=4;pad.analog[1]=128;pad.lx=1234;
    keys={};keys.analog[0]=true;
    heroes::ApplyKeyboardPad(0,true,keys,pad);
    assert(pad.buttons==4&&pad.analog[0]==255&&pad.analog[1]==128&&pad.lx==1234);
    // Polling starts with a fresh physical report: released keys do not stick.
    pad={};keys={};heroes::ApplyKeyboardPad(0,true,keys,pad);
    assert(pad.buttons==0&&pad.analog[0]==0&&pad.lx==0);
    pad.lx=100;pad.ly=-100;heroes::FilterController(pad,15);assert(pad.lx==0&&pad.ly==0);
    pad.lx=32767;pad.ly=0;heroes::FilterController(pad,15);assert(pad.lx==32767&&pad.ly==0);
    pad.lx=-32768;pad.ly=-32768;heroes::FilterController(pad,15);
    assert(pad.lx<0&&pad.ly<0&&std::abs(std::sqrt(float(pad.lx)*pad.lx+float(pad.ly)*pad.ly)-32767)<3);
    pad.lx=15000;pad.ly=0;heroes::FilterController(pad,0);assert(std::abs(pad.lx-15000)<=1);
}
