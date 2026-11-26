#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <string>
#include <imgui.h>
#include <toml++/toml.hpp>
#include "app/app.h"
#include "player_options.h"
#include "cheats.h"
#include "front_end.h"
namespace heroes {
namespace {
int learning=-1;
std::string KeyName(uint32_t key) {
    char name[64]{};LONG scan=LONG(MapVirtualKeyA(key,MAPVK_VK_TO_VSC)<<16);
    if(key>=VK_PRIOR&&key<=VK_DOWN)scan|=1<<24;
    if(!GetKeyNameTextA(scan,name,64))snprintf(name,64,"Key %u",key);
    return name;
}
}
void LoadOptions(const void* data) {
    auto& t=*static_cast<const toml::table*>(data);
    skip_boot_videos=t["skip_boot_videos"].value_or(false);
    if(auto a=t["keyboard"].as_array())for(size_t i=0;i<std::min(a->size(),size_t(24));i++) {
        auto k=(*a)[i].value_or(int64_t(keys[i]));
        if(k>0&&k<255&&k!=VK_F11&&k!=VK_F3)keys[i]=uint32_t(k);
    }
    deadzone_percent=std::min(deadzone_percent,40u);
}
void SaveOptions(void* data) {
    static_cast<toml::table*>(data)->insert_or_assign("skip_boot_videos",skip_boot_videos.load());
    toml::array a;for(auto key:keys)a.push_back(int64_t(key));
    static_cast<toml::table*>(data)->insert_or_assign("keyboard",std::move(a));
}
bool WindowMessage(void* handle,uint32_t msg,uintptr_t key,intptr_t lp,intptr_t* result) {
    if(msg==WM_KEYDOWN&&key==VK_ESCAPE&&!(lp&(intptr_t(1)<<30))&&
       main_menu_active.load()&&!menu_open.load()&&!exit_prompt_open.exchange(true)) {
        // A native modal dialog pumps messages. Do not hold UiLock while it is
        // open: rendering and input polling need that lock on other threads.
        const int choice=MessageBoxW(static_cast<HWND>(handle),L"Do you want to close Dungeons & Dragons: Heroes?",
                                     L"Close game?",MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2);
        if(choice==IDYES)PostMessageW(static_cast<HWND>(handle),WM_CLOSE,0,0);
        exit_prompt_open=false;*result=0;return true;
    }
    if(msg==WM_KEYDOWN&&!(lp&(intptr_t(1)<<30))) {
        std::lock_guard lock(app::UiLock());
        if(key==VK_F11){menu_open=!menu_open.load();learning=-1;*result=0;return true;}
        if(menu_open&&learning>=0){
            if(key!=VK_ESCAPE&&key!=VK_F3&&key>0&&key<255){keys[learning]=uint32_t(key);app::Save();}
            learning=-1;*result=0;return true;
        }
    }
    return false;
}
void Rumble(int,uint16_t& left,uint16_t& right) {
    std::lock_guard lock(app::UiLock());
    if(!rumble_enabled||menu_open||exit_prompt_open){left=right=0;}
}
void DrawOptions(double fps) {
    static std::array<float,120> history{};static int cursor=0;
    static auto previous=std::chrono::steady_clock::now();auto now=std::chrono::steady_clock::now();
    history[cursor]=std::chrono::duration<float,std::milli>(now-previous).count();cursor=(cursor+1)%120;previous=now;
    if(show_fps) {
        ImGui::SetNextWindowPos(ImVec2(12,12),ImGuiCond_Always);
        ImGui::SetNextWindowBgAlpha(0.75f);
        ImGui::Begin("Performance",nullptr,ImGuiWindowFlags_NoDecoration|ImGuiWindowFlags_AlwaysAutoResize|
                     ImGuiWindowFlags_NoInputs|ImGuiWindowFlags_NoSavedSettings);
        ImGui::Text("%.1f FPS  |  %.2f ms",fps,fps>0?1000.0/fps:0);
        ImGui::End();
    }
    bool open=menu_open.load();ImGui::GetIO().MouseDrawCursor=open;
    if(!open)return;
    ImGui::SetNextWindowSize(ImVec2(550,530),ImGuiCond_FirstUseEver);
    if(ImGui::Begin("D&D Heroes - PC options (F11)",&open)) {
        if(ImGui::BeginTabBar("Options")) {
            if(ImGui::BeginTabItem("Graphics")) {
                auto& s=app::Get();ImGui::Checkbox("Show FPS",&show_fps);
                bool skip=skip_boot_videos.load();
                if(ImGui::Checkbox("Skip boot videos (next launch)",&skip))skip_boot_videos=skip;
                ImGui::Text("%.1f FPS | %.2f ms/frame",fps,fps>0?1000.0/fps:0);
                ImGui::PlotLines("Frame time (ms)",history.data(),120,cursor,nullptr,0,50,ImVec2(0,70));
                int mode=int(s.display_mode);
                if(ImGui::Combo("Display mode",&mode,"Fullscreen\0Borderless fullscreen\0Windowed\0"))s.display_mode=app::DisplayMode(mode);
                int resolution=0;const uint32_t widths[]{0,1280,1600,1920,2560,3840},heights[]{0,720,900,1080,1440,2160};
                for(int i=0;i<6;i++)if(s.width==widths[i]&&s.height==heights[i])resolution=i;
                if(ImGui::Combo("Resolution",&resolution,"Desktop\0001280 x 720\0001600 x 900\0001920 x 1080\0002560 x 1440\0003840 x 2160\0")){
                    s.width=widths[resolution];s.height=heights[resolution];
                }
                int scale=int(s.render_percent);if(ImGui::SliderInt("Render scale (%)",&scale,25,200))s.render_percent=uint32_t(scale);
                ImGui::TextWrapped("Above 100%%: supersampling anti-aliasing. Lower scale improves GPU performance; higher scale costs more.");
                int an=int(s.aniso);if(ImGui::SliderInt("Anisotropic filtering",&an,0,16))s.aniso=an;
                ImGui::Checkbox("VSync",&s.vsync);int cap=s.fps_cap;
                if(ImGui::InputInt("FPS cap (0 = unlimited)",&cap))s.fps_cap=uint32_t(std::clamp(cap,0,240));
                ImGui::TextWrapped("60 FPS is the recommended gameplay cap. The counter measures presented game frames.");
                if(ImGui::Button("Apply display and save")){app::Save();app::ApplyDisplay();}
                ImGui::EndTabItem();
            }
            if(ImGui::BeginTabItem("Controls")) {
                int dz=int(deadzone_percent);if(ImGui::SliderInt("Stick deadzone (%)",&dz,0,40))deadzone_percent=dz;
                ImGui::Checkbox("Controller vibration",&rumble_enabled);
                ImGui::TextWrapped("SDL supports Xbox, PlayStation and Switch controllers, hot-plugging and four ports. Keyboard shares player one. RB/LB map to Xbox Black/White.");
                ImGui::TextWrapped("Click a binding, then press a key. Escape cancels. F3 and F11 are reserved.");
                ImGui::BeginChild("Keys",ImVec2(0,245),true);
                for(int i=0;i<24;i++){ImGui::PushID(i);ImGui::TextUnformatted(key_labels[i]);ImGui::SameLine(260);
                    if(ImGui::Button(learning==i?"Press a key...":KeyName(keys[i]).c_str(),ImVec2(160,0)))learning=i;
                    ImGui::PopID();}
                ImGui::EndChild();if(ImGui::Button("Save controls"))app::Save();
                ImGui::EndTabItem();
            }
            if(ImGui::BeginTabItem("Cheats")) {
                const auto players=cheat_active_players.load();
                if(players)ImGui::Text("Active heroes: %u",players);
                else ImGui::TextUnformatted("Waiting for active gameplay.");
                if(ImGui::Button("Disable all temporary cheats"))DisableCheats();
                ImGui::BeginChild("Cheat options",ImVec2(0,340),true);
                auto toggle=[](const char* label,std::atomic<bool>& flag){bool value=flag.load();if(ImGui::Checkbox(label,&value))flag=value;};
                auto number=[](const char* label,std::atomic<int>& field,int low,int high){int value=field.load();if(ImGui::InputInt(label,&value))field=std::clamp(value,low,high);};
                ImGui::TextUnformatted("TEMPORARY - reset each launch");
                toggle("God mode",god_mode);
                toggle("Unlimited mana",unlimited_mana);
                toggle("Unlimited special charges (finishers)",unlimited_special_charges);
                ImGui::TextDisabled("Keeps selected finishers charged; restores the original meter when disabled.");
                toggle("One-hit kills (monsters)",one_hit_kill);
                toggle("Easy blocking - 90% damage reduction",easy_blocking);
                toggle("Auto combo - repeat A while held",auto_combo);
                toggle("Auto revive fallen heroes",auto_revive);
                toggle("Show player circles",player_circles);
                toggle("Buff HUD test (zero-strength buffs)",buff_preview);
                toggle("Freeze XP gains",freeze_xp);
                toggle("Boost health pool",temporary_health);
                number("Health limit",health_limit,1,100000);
                toggle("Unlock moves temporarily",temporary_moves);
                number("Move level",move_level,1,4);
                toggle("Unlock melee temporarily",temporary_melee);
                number("Melee level",melee_level,1,4);
                toggle("Borrow original debug items",temporary_items);
                toggle("Borrow original gem quest flags",temporary_gems);
                ImGui::TextWrapped("Borrowed stats and stock are restored when disabled and removed before native save/copy paths. Pickups added to borrowed stock are retained.");
                ImGui::TextWrapped("Using items, reviving heroes, killing enemies or opening gem doors can still change the world. XP freeze prevents new XP; it does not preview higher levels.");
                ImGui::Separator();
                ImGui::TextUnformatted("PERMANENT ACTIONS - can be saved");
                ImGui::TextWrapped("These change real character values or quest progress. Turning off temporary cheats does not undo these actions.");
                number("Experience points",xp_value,0,1000000);
                auto action=[](const char* label,CheatAction requested){if(ImGui::Button(label)){cheat_action_result=3;cheat_action=requested;}};
                ImGui::BeginDisabled(!players||cheat_action_result.load()==3);
                action("Revive fallen heroes now",CheatAction::Revive);
                action("Set health permanently",CheatAction::Health);
                action("Set XP permanently",CheatAction::XP);
                action("Unlock moves permanently",CheatAction::Moves);
                action("Unlock melee permanently",CheatAction::Melee);
                action("Grant original debug items permanently",CheatAction::Items);
                action("Grant original gem quest flags permanently",CheatAction::Gems);
                action("Run original buff test on hero 1",CheatAction::Buffs);
                ImGui::EndDisabled();
                switch(cheat_action_result.load()) {
                    case 1:ImGui::TextUnformatted("Action applied.");break;
                    case 2:ImGui::TextUnformatted("No active heroes; action not applied.");break;
                    case 3:ImGui::TextUnformatted("Applying on the next game frame...");break;
                }
                ImGui::EndChild();
                ImGui::EndTabItem();
            }
            ImGui::EndTabBar();
        }
        ImGui::Separator();ImGui::TextWrapped("Game input is released while this menu is open. The game continues running; use Start to pause first.");
    }
    ImGui::End();menu_open=open;
}
}
