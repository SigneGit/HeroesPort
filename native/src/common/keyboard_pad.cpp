#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include "app/app.h"
#include "keyboard_pad.h"
#include "player_options.h"
#include "controller_policy.h"
#include "cheats.h"
#include "front_end.h"

void HeroesKeyboardPad(int port,input::Pad& pad) {
    std::lock_guard lock(app::UiLock());
    const bool focused=GetForegroundWindow()==static_cast<HWND>(app::Window());
    if(!focused||heroes::menu_open||heroes::exit_prompt_open){bool connected=pad.connected||port==0;pad={};pad.connected=connected;return;}
    heroes::FilterController(pad,heroes::deadzone_percent);
    if(port!=0){
        if(heroes::auto_combo.load() && GetTickCount64()%240>=160)pad.analog[0]=0;
        return;
    }
    heroes::KeyboardPadState keys;
    if(focused) {
        auto held=[](int key){return !(key==VK_ESCAPE&&heroes::main_menu_active.load())&&(GetAsyncKeyState(key)&0x8000)!=0;};
        for(int i=0;i<8;++i){keys.digital[i]=held(heroes::keys[i]);keys.analog[i]=held(heroes::keys[8+i]);}
        if(heroes::keys[8]==VK_SPACE)keys.analog[0]|=held('Z');
        if(heroes::keys[9]==VK_BACK)keys.analog[1]|=held(VK_ESCAPE)||held('X');
        keys.lx=int(held(heroes::keys[17]))-int(held(heroes::keys[16]));
        keys.ly=int(held(heroes::keys[19]))-int(held(heroes::keys[18]));
        keys.rx=int(held(heroes::keys[21]))-int(held(heroes::keys[20]));
        keys.ry=int(held(heroes::keys[23]))-int(held(heroes::keys[22]));
    }
    heroes::ApplyKeyboardPad(port,focused,keys,pad);
    if(heroes::auto_combo.load() && GetTickCount64()%240>=160)pad.analog[0]=0;
}
