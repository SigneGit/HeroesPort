#include "common/cheat_policy.h"
#include <cassert>
#include <limits>

int main() {
    using heroes::ShouldRefillMana;
    assert(ShouldRefillMana(true, 100, 0, 50));
    assert(ShouldRefillMana(true, 1, 49.5f, 50));
    assert(!ShouldRefillMana(false, 100, 0, 50));
    assert(!ShouldRefillMana(true, 0, 0, 50));
    assert(!ShouldRefillMana(true, -1, 0, 50));
    assert(!ShouldRefillMana(true, 100, 50, 50));
    assert(!ShouldRefillMana(true, 100, 100, 50)); // retain temporary over-max values
    assert(!ShouldRefillMana(true, 100, -1, 50));
    assert(!ShouldRefillMana(true, 100, 0, 0));
    const auto nan=std::numeric_limits<float>::quiet_NaN();
    const auto inf=std::numeric_limits<float>::infinity();
    assert(!ShouldRefillMana(true, nan, 0, 50));
    assert(!ShouldRefillMana(true, 100, nan, 50));
    assert(!ShouldRefillMana(true, 100, 0, nan));
    assert(!ShouldRefillMana(true, inf, 0, 50));
    assert(!ShouldRefillMana(true, 100, 0, inf));
}
