#include "region.h"
#include "cpu/x86_context.h"
#include "kernel/kernel.h"
#include "core/log.h"

#include <array>
#include <chrono>
#include <cstdlib>
#include <cstring>

namespace {
enum class AnimationMode { Off, Observe, Full };
AnimationMode Mode() {
    static const auto mode = [] {
        const char* value = std::getenv("HEROES_ANIMATION_TEST");
        if (value && std::strcmp(value, "observe") == 0) return AnimationMode::Observe;
        if (value && std::strcmp(value, "full") == 0) return AnimationMode::Full;
        return AnimationMode::Off;
    }();
    return mode;
}
bool Readable(uint32_t address, uint32_t bytes) {
    if (address < mem::kUserLow || uint64_t(address) + bytes > UINT32_MAX) return false;
    const auto last = (address + bytes - 1) & ~(mem::kPage - 1);
    for (auto page = address & ~(mem::kPage - 1);; page += mem::kPage) {
        if (!mem::IsCommitted(page)) return false;
        if (page == last) return true;
    }
}
struct Pose {
    uint32_t address = 0, last_frame = UINT32_MAX, time = 0;
    uint32_t frames = 0, changed = 0;
};
struct AnimationStats {
    uint32_t frame = 0, entries = 0, eligible = 0, candidates = 0, skipped = 0, steps = 0;
    uint32_t advance_calls = 0, advances = 0, samples = 0, overflow = 0;
    std::array<Pose, 128> poses{};
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
};
// No cross-thread guest state access or saved object dereferences. Pose addresses
// are diagnostic keys only, discarded every 120 presents. Other guest threads
// have independent counters; the report describes the presenting thread.
thread_local AnimationStats stats;
}

void HeroesAnimationFrame(X86Context&, uint8_t*) {
    if (Mode() == AnimationMode::Off) return;
    static thread_local bool announced = false;
    if (!announced) {
        LOGR("heroes: animation test mode=%s; skeletal alternate-frame bypass only; videos/UI unchanged",
             Mode() == AnimationMode::Full ? "full" : "observe");
        announced = true;
    }
    if (++stats.frame < 120) return;
    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - stats.start).count();
    LOGR("heroes: animation cadence mode=%s presents=%u seconds=%.3f models=%u eligible=%u alternate_candidates=%u skipped=%u steps=%u advance_calls=%u advances=%u joint_samples=%u untracked_samples=%u",
         Mode() == AnimationMode::Full ? "full" : "observe", stats.frame, seconds,
         stats.entries, stats.eligible, stats.candidates, stats.skipped, stats.steps,
         stats.advance_calls, stats.advances, stats.samples, stats.overflow);
    unsigned reported = 0;
    for (const auto& pose : stats.poses) {
        if (!pose.address || reported == 4) continue;
        LOGR("heroes: animation track=%08X sampled_frames=%u changed_time_frames=%u last_time_bits=%08X",
             pose.address, pose.frames, pose.changed, pose.time);
        ++reported;
    }
    stats = AnimationStats{};
}
void HeroesAnimationModelEntry(X86Context&, uint8_t*) {
    if (Mode() != AnimationMode::Off) ++stats.entries;
}
bool HeroesAnimationAlternateGate(X86Context& ctx, uint8_t*) {
    if (Mode() == AnimationMode::Off) return false;
    ++stats.eligible;
    if (Readable(heroes::GuestAddress(0x49d094), 1) && Readable(ctx.ebp, 0x111) && Readable(heroes::GuestAddress(0x49c7fc), 4)) {
        const auto render = kernel::R32(heroes::GuestAddress(0x49c7fc));
        if (Readable(render, 0x10) && *static_cast<uint8_t*>(kernel::HostPtr(heroes::GuestAddress(0x49d094))) &&
            (*static_cast<uint8_t*>(kernel::HostPtr(ctx.ebp + 0xea)) & kernel::R32(render + 0xc) & 1)) ++stats.candidates;
    }
    // At B111E, EAX contains the flags needed at B1161. Preserve it, x87,
    // elapsed-time accumulation, context guards and the entire native update.
    // Full mode skips only the optional alternate-frame early-return block.
    return Mode() == AnimationMode::Full;
}
void HeroesAnimationSkipped(X86Context&, uint8_t*) {
    if (Mode() != AnimationMode::Off) ++stats.skipped;
}
void HeroesAnimationStep(X86Context&, uint8_t*) {
    if (Mode() != AnimationMode::Off) ++stats.steps;
}
void HeroesAnimationAdvanceCall(X86Context&, uint8_t*) {
    if (Mode() != AnimationMode::Off) ++stats.advance_calls;
}
void HeroesAnimationAdvance(X86Context&, uint8_t*) {
    if (Mode() != AnimationMode::Off) ++stats.advances;
}
void HeroesAnimationSample(X86Context& ctx, uint8_t*) {
    if (Mode() == AnimationMode::Off) return;
    ++stats.samples;
    for (auto& pose : stats.poses) {
        if (pose.address && pose.address != ctx.ecx) continue;
        // Many joints sample one animation each frame. Count time changes only
        // once per presented-frame interval, not once per joint.
        if (pose.last_frame != stats.frame) {
            if (!Readable(ctx.ecx, 0x44)) return;
            pose.address = ctx.ecx;
            const auto time = kernel::R32(ctx.ecx + 0x40);
            if (pose.frames && time != pose.time) ++pose.changed;
            pose.time = time;
            pose.last_frame = stats.frame;
            ++pose.frames;
        }
        return;
    }
    ++stats.overflow;
}
