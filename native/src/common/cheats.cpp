#include "region.h"
#include "cheats.h"
#include "cheat_policy.h"
#include "temporary_cheat.h"
#include "cpu/x86_context.h"
#include "core/log.h"
#include "kernel/kernel.h"
#include "kernel/memory.h"

#include <array>
#include <cstring>
#include <limits>
#include <vector>
#include <bit>
#include <algorithm>

namespace {
// Supported executable only. Original debug callbacks 2C190 and 2B5A0
// obtain players through singleton 49D0B8 -> +14 -> table +246F8.
uint32_t PlayersRoot() { return heroes::GuestAddress(0x49d0b8); }
constexpr uint32_t kManager = 0x14, kPlayers = 0x246f8;
constexpr uint32_t kHealth = 0x74, kMana = 0x24b0, kMaxMana = 0x24b4;

bool Readable(uint32_t address, uint32_t bytes) {
    if (address < mem::kUserLow || !bytes || uint64_t(address) + bytes > uint64_t(UINT32_MAX)) return false;
    const uint32_t last = address + bytes - 1;
    for (uint32_t page = address & ~(mem::kPage - 1);; page += mem::kPage) {
        if (!mem::IsCommitted(page)) return false;
        if (page >= (last & ~(mem::kPage - 1))) return true;
    }
}

std::array<uint32_t, 4> Players() {
    std::array<uint32_t, 4> players{};
    if (!Readable(PlayersRoot(), 4)) return players;
    const auto root = kernel::R32(PlayersRoot());
    if (!Readable(root, kManager + 4)) return players;
    const auto manager = kernel::R32(root + kManager);
    if (!Readable(manager, kPlayers + 16)) return players;
    for (uint32_t i = 0; i < players.size(); ++i) {
        const auto player = kernel::R32(manager + kPlayers + i * 4);
        if (Readable(player, 0x2d20)) players[i] = player;
    }
    return players;
}

bool GodModePlayer(uint32_t entity) {
    if (!heroes::god_mode.load(std::memory_order_relaxed) || !entity) return false;
    for (auto player : Players()) if (player == entity) return true;
    return false;
}

float ReadFloat(uint32_t address) {
    float value;
    std::memcpy(&value, kernel::HostPtr(address), sizeof(value));
    return value;
}
void ExpandedFrame(X86Context&, const std::array<uint32_t,4>&);
}

// Called on the title thread before its gameplay Present. No persistent
// object pointer is retained across frames, map changes or character changes.
void HeroesCheatFrame(X86Context& ctx, uint8_t*) {
    uint32_t active = 0;
    const auto players=Players();
    ExpandedFrame(ctx,players);
    const bool mana = heroes::unlimited_mana.load(std::memory_order_relaxed);
    for (auto player : players) {
        if (!player) continue;
        ++active;
        if (!mana) continue;
        const float current = ReadFloat(player + kMana), maximum = ReadFloat(player + kMaxMana);
        if (heroes::ShouldRefillMana(mana, ReadFloat(player + kHealth), current, maximum)) {
            std::memcpy(kernel::HostPtr(player + kMana), &maximum, sizeof(maximum));
            LOG_FIRST(4, "heroes: unlimited mana refilled hero %08X from %.1f to %.1f", player, current, maximum);
        }
    }
    heroes::cheat_active_players.store(active, std::memory_order_relaxed);
}

// Resume the original invulnerable branch, without changing its saved flag.
bool HeroesGodModeDamage(X86Context& ctx, uint8_t*) {
    const bool enabled = GodModePlayer(ctx.edi);
    if (enabled) LOG_FIRST(4, "heroes: god mode blocked damage for hero %08X", ctx.edi);
    return enabled;
}
bool HeroesGodModeQuery(X86Context& ctx, uint8_t*) { return GodModePlayer(ctx.ecx); }

namespace {
struct Field { uint32_t offset; heroes::TemporaryCount value; bool pickups; uint32_t bytes; };
struct PlayerOverrides {
    uint32_t player=0;
    std::vector<Field> fields;
    bool health=false;
    float original_max=0,last_max=0;
    bool special=false;
    float original_special=0;
    std::vector<uint32_t> preview_buffs;
};
std::array<PlayerOverrides,4> overrides;
constexpr std::array<uint32_t,6> gem_flags{101,100,102,26,103,405};
uint32_t gem_owner=0;
std::array<heroes::TemporaryCount,6> gem_values;
uint32_t circle_owner=0;
bool circle_original=false,circle_applied=false;

bool IsPlayer(uint32_t entity) {
    if(!entity)return false;
    for(auto player:Players())if(player==entity)return true;
    return false;
}
uint32_t Manager() {
    const auto root=kernel::R32(PlayersRoot());
    return Readable(root,0x18)?kernel::R32(root+0x14):0;
}
uint32_t QuestTable() {
    const auto manager=Manager();
    return Readable(manager,0x24684)?kernel::R32(manager+0x24680):0;
}
uint32_t ReadField(uint32_t at,uint32_t bytes) {
    if(bytes==1)return *static_cast<uint8_t*>(kernel::HostPtr(at));
    return kernel::R32(at);
}
void WriteField(uint32_t at,uint32_t value,uint32_t bytes) {
    std::memcpy(kernel::HostPtr(at),&value,bytes);
}
void SetField(PlayerOverrides& state,uint32_t offset,uint32_t desired,bool enabled,bool pickups=false,uint32_t bytes=4) {
    auto it=std::find_if(state.fields.begin(),state.fields.end(),[&](const Field& f){return f.offset==offset;});
    if(!enabled && it==state.fields.end())return;
    if(it==state.fields.end()){state.fields.push_back({offset,{},pickups,bytes});it=state.fields.end()-1;}
    const auto current=int32_t(ReadField(state.player+offset,bytes));
    if(enabled)WriteField(state.player+offset,uint32_t(it->value.Apply(current,int32_t(desired),pickups)),bytes);
    else {WriteField(state.player+offset,uint32_t(it->value.Restore(current,pickups)),bytes);state.fields.erase(it);}
}
void SetHealth(PlayerOverrides& state,bool enabled) {
    const auto player=state.player;
    const float current=ReadFloat(player+0x24ac),hp=ReadFloat(player+0x74);
    if(!std::isfinite(current)||current<=0||!std::isfinite(hp))return;
    if(enabled) {
        if(!state.health){state.original_max=current;state.last_max=current;state.health=true;}
        // Positive changes while boosted are retained (e.g. a native level-up).
        if(current>state.last_max)state.original_max+=current-state.last_max;
        const float target=std::max(state.original_max,float(heroes::health_limit.load()));
        const float new_hp=hp>0?std::clamp(hp+target-current,1.0f,target):hp;
        std::memcpy(kernel::HostPtr(player+0x24ac),&target,4);
        std::memcpy(kernel::HostPtr(player+0x74),&new_hp,4);
        state.last_max=target;
    } else if(state.health) {
        if(current>state.last_max)state.original_max+=current-state.last_max;
        const float new_hp=hp>0?std::clamp(hp-(state.last_max-state.original_max),1.0f,state.original_max):hp;
        std::memcpy(kernel::HostPtr(player+0x24ac),&state.original_max,4);
        std::memcpy(kernel::HostPtr(player+0x74),&new_hp,4);
        state.health=false;
    }
}
void SetSpecial(PlayerOverrides& state,bool enabled) {
    // Native update D645C/D64B5 checks both equipped move slots; the action
    // property bIsFinisher is byte +106. HUD 39471 caps the meter at 3.
    bool selected=false;
    for(auto slot:{0x1afcu,0x1b00u}) {
        const auto id=kernel::R32(state.player+slot);
        if(id>20)continue;
        const auto action=kernel::R32(state.player+0x3c0+id*16);
        if(Readable(action,0x107)&&ReadField(action+0x106,1))selected=true;
    }
    const float current=ReadFloat(state.player+0x1b08);
    enabled=enabled&&selected&&std::isfinite(current)&&ReadFloat(state.player+kHealth)>0;
    if(enabled) {
        if(!state.special){state.original_special=current;state.special=true;}
        const float full=3.0f;
        std::memcpy(kernel::HostPtr(state.player+0x1b08),&full,4);
    } else if(state.special) {
        std::memcpy(kernel::HostPtr(state.player+0x1b08),&state.original_special,4);
        state.special=false;
    }
}
void Restore(PlayerOverrides& state) {
    if(!state.player||!Readable(state.player,0x2d20)){state={};return;}
    SetHealth(state,false);
    SetSpecial(state,false);
    for(auto& f:state.fields) {
        const auto current=int32_t(ReadField(state.player+f.offset,f.bytes));
        WriteField(state.player+f.offset,uint32_t(f.value.Restore(current,f.pickups)),f.bytes);
    }
    state.fields.clear();
}
void RestoreGems() {
    if(gem_owner&&Readable(gem_owner,0xe8+406*8))for(size_t i=0;i<gem_flags.size();++i) {
        auto& value=gem_values[i];
        if(value.active)WriteField(gem_owner+0xe4+gem_flags[i]*8,
            uint32_t(value.Restore(int32_t(ReadField(gem_owner+0xe4+gem_flags[i]*8,1)))),1);
    }
    gem_owner=0;gem_values={};
}
uint32_t CallThis(X86Context& ctx,uint32_t fn,uint32_t self,std::initializer_list<uint32_t> args) {
    const auto saved=ctx.ecx;ctx.ecx=self;
    const auto result=kernel::CallGuest(ctx,fn,args);ctx.ecx=saved;return result;
}
constexpr std::array<uint32_t,9> preview_ids{0x12,0x1a,0x25,0x2c,0x2b,0x2a,0x2d,0x22,0x2f};
void RemovePreview(PlayerOverrides& state,X86Context& ctx) {
    if(!state.player||!Readable(state.player,0x2d20)){state.preview_buffs.clear();return;}
    for(auto id:state.preview_buffs) {
        const auto index=CallThis(ctx,heroes::GuestAddress(0xc5290),state.player,{id});
        const auto count=ReadField(state.player+0x2472,1);
        if(index>=count||count>15||ReadFloat(state.player+0x19c8+index*20)!=0)continue;
        // The original expiration path negates magnitude, removes the entry
        // by swapping in the last 20-byte record, and refreshes the HUD.
        CallThis(ctx,heroes::GuestAddress(0xd4050),state.player,{id,0x80000000u});
        std::memmove(kernel::HostPtr(state.player+0x19b8+index*20),
            kernel::HostPtr(state.player+0x19b8+(count-1)*20),20);
        WriteField(state.player+0x2472,count-1,1);
    }
    if(!state.preview_buffs.empty())kernel::CallGuest(ctx,heroes::GuestAddress(0xd8d10),{ReadField(state.player+0x2471,1)});
    state.preview_buffs.clear();
}
void BuffPreview(PlayerOverrides& state,X86Context& ctx,bool enabled) {
    if(!enabled){RemovePreview(state,ctx);return;}
    for(auto id:preview_ids) {
        if(CallThis(ctx,heroes::GuestAddress(0xc5290),state.player,{id})!=UINT32_MAX)continue;
        if(ReadField(state.player+0x2472,1)>=15)break;
        CallThis(ctx,heroes::GuestAddress(0xd60d0),state.player,{id,0,0});
        if(CallThis(ctx,heroes::GuestAddress(0xc5290),state.player,{id})!=UINT32_MAX&&
            std::find(state.preview_buffs.begin(),state.preview_buffs.end(),id)==state.preview_buffs.end())
            state.preview_buffs.push_back(id);
    }
}
void PermanentAction(X86Context& ctx,heroes::CheatAction action) {
    // Remove overlays first, so a permanent action changes the actual baseline.
    for(auto& state:overrides){RemovePreview(state,ctx);Restore(state);}
    RestoreGems();
    static uint32_t descriptor=0;
    if(!descriptor)descriptor=mem::AllocSystem(0x40);
    if(!descriptor){heroes::cheat_action_result=2;return;}
    uint32_t fn=0;float value=0;
    switch(action) {
        case heroes::CheatAction::Revive:fn=heroes::GuestAddress(0x2b7a0);break;
        case heroes::CheatAction::Health:fn=heroes::GuestAddress(0x33720);value=float(heroes::health_limit.load());break;
        case heroes::CheatAction::XP:fn=heroes::GuestAddress(0x33760);value=float(heroes::xp_value.load());break;
        case heroes::CheatAction::Moves:fn=heroes::GuestAddress(0x33950);value=float(heroes::move_level.load());break;
        case heroes::CheatAction::Melee:fn=heroes::GuestAddress(0x339b0);value=float(heroes::melee_level.load());break;
        case heroes::CheatAction::Items:fn=heroes::GuestAddress(0x2b5f0);break;
        case heroes::CheatAction::Gems:fn=heroes::GuestAddress(0x2b650);break;
        case heroes::CheatAction::Buffs:fn=heroes::GuestAddress(0x2b6e0);break;
        default:return;
    }
    std::memcpy(kernel::HostPtr(descriptor+0x30),&value,4);
    kernel::CallGuest(ctx,fn,{descriptor});
    heroes::cheat_action_result=1;
    LOGI("heroes: applied permanent cheat action %u",unsigned(action));
}
void ExpandedFrame(X86Context& ctx,const std::array<uint32_t,4>& players) {
    bool any=false,changed=false;
    for(size_t i=0;i<players.size();++i) {
        if(players[i]!=overrides[i].player){overrides[i]={};overrides[i].player=players[i];changed=true;}
        any|=players[i]!=0;
    }
    const auto action=heroes::cheat_action.exchange(heroes::CheatAction::None);
    if(action!=heroes::CheatAction::None) {
        if(any)PermanentAction(ctx,action);else heroes::cheat_action_result=2;
    }
    bool revive=false;
    for(auto& state:overrides) {
        if(!state.player)continue;
        const auto p=state.player;
        SetHealth(state,heroes::temporary_health.load());
        SetSpecial(state,heroes::unlimited_special_charges.load());
        BuffPreview(state,ctx,heroes::buff_preview.load());
        for(uint32_t id=0;id<21;++id)SetField(state,0x3b8+id*16,uint32_t(-heroes::move_level.load()),heroes::temporary_moves.load());
        for(uint32_t id=21;id<150;++id)SetField(state,0x3b8+id*16,id==95||id==96?999:1000,heroes::temporary_items.load(),true);
        SetField(state,0x2718,999,heroes::temporary_items.load(),true);
        int melee=std::clamp(heroes::melee_level.load(),1,4);
        while(melee>0&&!kernel::R32(p+0x3c0+uint32_t(melee)*16))--melee;
        SetField(state,0x1af8,uint32_t(melee),heroes::temporary_melee.load());
        for(uint32_t id=1;id<=4;++id) {
            // A melee slot is outside the original 21..149 item grant range.
            if(!heroes::temporary_moves.load())SetField(state,0x3b8+id*16,UINT32_MAX,
                heroes::temporary_melee.load()&&id==uint32_t(melee));
        }
        if(heroes::auto_revive.load()&&kernel::R32(p+0x2468)==4)revive=true;
    }
    if(revive)kernel::CallGuest(ctx,heroes::GuestAddress(0x2b7a0),{0});
    const auto table=QuestTable();
    if(gem_owner && table!=gem_owner){gem_owner=0;gem_values={};}
    if(heroes::temporary_gems.load()&&any&&Readable(table,0xe8+406*8)) {
        gem_owner=table;
        for(size_t i=0;i<gem_flags.size();++i){const auto at=table+0xe4+gem_flags[i]*8;
            WriteField(at,uint32_t(gem_values[i].Apply(int32_t(ReadField(at,1)),1)),1);}
    }else RestoreGems();
    const auto manager=Manager();
    if(!Readable(manager,0x247cc)){circle_owner=0;circle_applied=false;return;}
    if(circle_owner!=manager){circle_owner=manager;circle_original=(kernel::R32(manager+0x247c8)&0x20)!=0;circle_applied=false;}
    const bool want=heroes::player_circles.load();
    if(want!=circle_applied || (want&&changed)) {
        CallThis(ctx,heroes::GuestAddress(0xb3bb0),manager,{uint32_t(want||circle_original)});circle_applied=want;
    }
}
}

// Save/copy paths see real attributes and real inventory, never borrowed stock.
void HeroesCheatBeforeSave(X86Context& ctx,uint8_t*) {
    for(auto& state:overrides)if(state.player==ctx.ecx){RemovePreview(state,ctx);Restore(state);}
    RestoreGems();
}
void HeroesCheatBeforePlayerCopy(X86Context& ctx,uint8_t*) {
    const auto source=kernel::R32(ctx.esp+4);
    for(auto& state:overrides)if(state.player==source){RemovePreview(state,ctx);Restore(state);}
}
void HeroesCheatRemovePlayer(X86Context& ctx,uint8_t*) {
    const auto slot=kernel::R32(ctx.esp+4);
    if(slot>=overrides.size()||ctx.ecx!=Manager())return;
    auto& state=overrides[slot];
    if(state.player==kernel::R32(ctx.ecx+kPlayers+slot*4)) {
        RemovePreview(state,ctx);Restore(state);state={};
    }
}
void HeroesCheatBeforeQuestCopy(X86Context&,uint8_t*) { RestoreGems(); }
void HeroesCheatQuestWrite(X86Context& ctx,uint8_t*) {
    if(ctx.edi!=gem_owner)return;
    for(size_t i=0;i<gem_flags.size();++i)if(gem_flags[i]==ctx.esi&&gem_values[i].active)
        gem_values[i].baseline=int32_t(ctx.ebx&0xff);
}
void HeroesCheatNewPlayer(X86Context& ctx,uint8_t*) {
    for(auto& state:overrides)if(state.player==ctx.ecx)state={};
}
bool HeroesCheatFreezeXP(X86Context& ctx,uint8_t*) {
    return heroes::freeze_xp.load()&&IsPlayer(ctx.ecx);
}
void HeroesCheatDamageReduction(X86Context& ctx,uint8_t*) {
    if(!heroes::easy_blocking.load()||!IsPlayer(ctx.esi))return;
    const double hp=ReadFloat(ctx.esi+0x74),next=ctx.st[ctx.top&7];
    if(std::isfinite(hp)&&std::isfinite(next)&&hp>0&&next<hp)
        ctx.st[ctx.top&7]=std::max(0.0,hp-(hp-next)*0.1);
}
namespace {
void OneHit(X86Context& ctx,uint32_t target,uint32_t descriptor,uint32_t source) {
    if(!heroes::one_hit_kill.load()||IsPlayer(target)||!Readable(target,0xa0)||!Readable(descriptor,0x28))return;
    bool hero=false;
    for(int depth=0;depth<4&&source;++depth) {
        if(IsPlayer(source)){hero=true;break;}
        if(!Readable(source,0xa0))break;
        source=kernel::R32(source+0x9c);
    }
    if(!hero)return;
    uint32_t monster=kernel::R32(heroes::GuestAddress(0x49d158));
    if(!monster)monster=kernel::CallGuest(ctx,heroes::GuestAddress(0xe2d60),{});
    // The guest RTTI predicate returns a bool in AL; its upper EAX bits
    // still contain a type pointer on a false return.
    if(!monster||!(CallThis(ctx,heroes::GuestAddress(0x15000),target,{monster})&0xffu))return;
    const auto hp=ReadFloat(target+0x74),damage=ReadFloat(descriptor+0x1c);
    if(std::isfinite(hp)&&std::isfinite(damage)&&hp>0&&damage>0) {
        const float remaining=std::min(hp,damage);
        std::memcpy(kernel::HostPtr(target+0x74),&remaining,4);
        LOG_FIRST(4,"heroes: one hit kill on monster %08X",target);
    }
}
}
void HeroesCheatOneHit(X86Context& ctx,uint8_t*) {
    OneHit(ctx,ctx.esi,ctx.edi,kernel::R32(ctx.esp+0x0c));
}
void HeroesCheatMonsterHit(X86Context& ctx,uint8_t*) {
    // mpsMonster routes hits through mpsPawn/F7F60 and the deferred actor
    // receiver 1BFAB0, rather than the base F6E90 path. At its final HP
    // subtraction EBX holds the descriptor; the EDI push has already popped.
    const auto source=kernel::R32(ctx.esp+0x1c);
    if(heroes::one_hit_kill.load())LOG_FIRST(6,"heroes: monster damage target %08X source %08X",ctx.esi,source);
    OneHit(ctx,ctx.esi,ctx.ebx,source);
}
