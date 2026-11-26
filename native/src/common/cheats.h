#pragma once
#include <atomic>
#include <cstdint>

namespace heroes {
// Session-only switches. The render/UI thread never reads or writes game objects.
inline std::atomic<bool> god_mode{false}, unlimited_mana{false}, unlimited_special_charges{false};
inline std::atomic<uint32_t> cheat_active_players{0};
inline std::atomic<bool> one_hit_kill{false}, easy_blocking{false}, auto_combo{false},
    temporary_health{false}, temporary_items{false}, temporary_moves{false},
    temporary_melee{false}, temporary_gems{false}, freeze_xp{false},
    auto_revive{false}, player_circles{false}, buff_preview{false};
inline std::atomic<int> health_limit{1000}, move_level{4}, melee_level{4}, xp_value{10000};
enum class CheatAction : uint32_t { None, Revive, Health, XP, Moves, Melee, Items, Gems, Buffs };
inline std::atomic<CheatAction> cheat_action{CheatAction::None};
inline std::atomic<uint32_t> cheat_action_result{0}; // 1 applied, 2 no heroes, 3 pending
inline void DisableCheats() {
    god_mode=false;unlimited_mana=false;unlimited_special_charges=false;one_hit_kill=false;easy_blocking=false;
    auto_combo=false;temporary_health=false;temporary_items=false;temporary_moves=false;
    temporary_melee=false;temporary_gems=false;freeze_xp=false;auto_revive=false;
    player_circles=false;buff_preview=false;
}
}
