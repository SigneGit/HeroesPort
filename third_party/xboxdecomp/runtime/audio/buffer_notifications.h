#pragma once
#include <cstdint>
#include <span>

namespace audio {
struct BufferNotification { uint32_t offset, event; };
inline constexpr uint32_t kNotifyStop = 0xFFFFFFFFu;

// The mixer advances from a normalized source-frame position. Half-open
// intervals avoid duplicate signals at exact boundaries, including offset 0.
// Event handles coalesce signals, so a large step spanning several complete
// loops needs to signal each registered event only once.
template<class FrameAt, class Signal>
void NotifyPlayback(std::span<const BufferNotification> entries, double from, double to,
                    double end, double loop_start, bool looping, FrameAt frame_at, Signal signal) {
    if (!(to > from) || !(end > 0)) return;
    for (const auto& n : entries) {
        if (n.offset == kNotifyStop) continue;
        const double target = frame_at(n.offset);
        const bool first = target >= from && target < to && target < end;
        const bool wrapped = looping && end > loop_start && to > end && target >= loop_start && target < end &&
                             to - end > target - loop_start;
        if (first || wrapped) signal(n.event);
    }
}

template<class Signal>
void NotifyStopped(std::span<const BufferNotification> entries, Signal signal) {
    for (const auto& n : entries) if (n.offset == kNotifyStop) signal(n.event);
}
} // namespace audio
