#include "core/frame_clock.h"
#include <cassert>

int main() {
    using namespace frame_clock;
    constexpr auto p = kPeriodNs;
    // Work done during this refresh reduces its remaining wait. The previous
    // full-period sleep would turn a 10 ms workload into a 26+ ms frame.
    for (int64_t frame = 0; frame < 100000; ++frame) {
        for (int64_t work : {0ll, 1000000ll, 10000000ll, p - 1}) {
            const auto now = frame * p + work;
            const auto next = NextTickNs(now);
            assert(next == (frame + 1) * p);
            assert(next > now && next - now <= p);
        }
    }
    // An over-budget frame skips expired ticks instead of trying to catch up
    // or adding a whole refresh after its processing time.
    assert(NextTickNs(2 * p + 5000000) == 3 * p);
    auto now = std::chrono::steady_clock::time_point(std::chrono::nanoseconds(10 * p + 1000000));
    auto next = NextTick(now);
    assert(next > now);
    assert(next - now <= std::chrono::nanoseconds(p));
}
