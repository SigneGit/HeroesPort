#pragma once
#include <cmath>

namespace heroes {
inline bool ShouldRefillMana(bool enabled, float health, float mana, float maximum) {
    return enabled && std::isfinite(health) && health > 0 &&
           std::isfinite(mana) && mana >= 0 && std::isfinite(maximum) &&
           maximum > 0 && mana < maximum;
}
}
