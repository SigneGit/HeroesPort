#pragma once
#include <chrono>
#include <cstdint>

namespace frame_clock {
// One NTSC clock shared by the interrupt and explicit vertical-blank waits.
// Waiting after doing work must consume the remainder of a refresh, not add
// another whole refresh to every frame. Integer division avoids accumulated drift.
inline constexpr int64_t kPeriodNs = 1000000000ll / 60;
inline int64_t NextTickNs(int64_t now) { return (now / kPeriodNs + 1) * kPeriodNs; }
inline std::chrono::steady_clock::time_point NextTick(std::chrono::steady_clock::time_point now) {
    auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(now.time_since_epoch()).count();
    return std::chrono::steady_clock::time_point(
        std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::nanoseconds(NextTickNs(ns))));
}
}  // namespace frame_clock
