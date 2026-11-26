// Test the actual hooks against synthetic guest memory, without game assets.
#include "common/animation_test.cpp"
#include <cassert>
#include <cstdarg>
#include <cstdio>
#include <string>
#include <vector>

namespace { std::vector<uint8_t> guest(8 * 1024 * 1024); std::string reports; }
namespace kernel { uint8_t* g_base = guest.data(); }
namespace mem { bool IsCommitted(uint32_t va) { return va >= kUserLow && va < guest.size(); } }
namespace logx {
void Write(Level, const char* format, ...) {
    char line[1024]; va_list args; va_start(args, format);
    std::vsnprintf(line, sizeof(line), format, args); va_end(args);
    reports += line; reports += '\n';
}
}

int main(int argc, char** argv) {
    assert(argc == 2);
    const bool full = std::strcmp(argv[1], "full") == 0;
    const bool enabled = full || std::strcmp(argv[1], "observe") == 0;
    X86Context ctx{}; ctx.ebp = 0x510000; ctx.ecx = 0x520000;
    ctx.eax = 0x12345678; ctx.esp = 0x530000;
    ctx.top = 2; ctx.st[2] = 0.125;
    kernel::W32(0x49c7fc, 0x540000); kernel::W32(0x54000c, 1);
    guest[0x49d094] = 1; guest[ctx.ebp + 0xea] = 1;
    // Sentinel elapsed time, accumulated delta and sample time must survive
    // every hook unchanged. No guest clock or object field may be patched.
    kernel::W32(0x49c160, 0x3c888889);
    kernel::W32(ctx.ebp + 0x110, 0x3c888889);
    kernel::W32(ctx.ecx + 0x40, 0x3e800000);
    const auto before = guest;
    const auto registers = ctx;
    HeroesAnimationModelEntry(ctx, nullptr);
    assert(HeroesAnimationAlternateGate(ctx, nullptr) == full);
    HeroesAnimationAdvanceCall(ctx, nullptr); HeroesAnimationAdvance(ctx, nullptr);
    HeroesAnimationStep(ctx, nullptr);
    HeroesAnimationSample(ctx, nullptr); HeroesAnimationSample(ctx, nullptr);
    assert(guest == before);
    assert(std::memcmp(&ctx, &registers, sizeof(ctx)) == 0);
    if (enabled) {
        assert(stats.entries == 1 && stats.eligible == 1 && stats.candidates == 1);
        assert(stats.samples == 2 && stats.poses[0].frames == 1 && stats.poses[0].changed == 0);
        // Repeated joint sampling must not inflate pose cadence. A new present
        // interval with a new sample time counts exactly once.
        HeroesAnimationFrame(ctx, nullptr);
        kernel::W32(ctx.ecx + 0x40, 0x3e900000);
        HeroesAnimationSample(ctx, nullptr); HeroesAnimationSample(ctx, nullptr);
        assert(stats.poses[0].frames == 2 && stats.poses[0].changed == 1);
        HeroesAnimationFrame(ctx, nullptr);
        HeroesAnimationSample(ctx, nullptr);
        assert(stats.poses[0].frames == 3 && stats.poses[0].changed == 1);
        guest[0x49d094] = 0;
        assert(HeroesAnimationAlternateGate(ctx, nullptr) == full);
        assert(stats.candidates == 1); // a disabled skip isn't an active candidate
        ctx.ebp = 0xffffffff; kernel::W32(0x49c7fc, 0xfffffff0);
        assert(HeroesAnimationAlternateGate(ctx, nullptr) == full); // no invalid dereference
        ctx.ecx = 0xffffffff; HeroesAnimationSample(ctx, nullptr);
        for (unsigned i = stats.frame; i < 120; ++i) HeroesAnimationFrame(ctx, nullptr);
        assert(reports.find("presents=120") != std::string::npos);
        assert(reports.find("sampled_frames=3 changed_time_frames=1") != std::string::npos);
        assert(stats.frame == 0 && stats.poses[0].address == 0); // scene pointers aren't retained
    } else {
        HeroesAnimationSkipped(ctx, nullptr); HeroesAnimationFrame(ctx, nullptr);
        assert(stats.entries == 0 && stats.samples == 0 && stats.frame == 0 && reports.empty());
    }
}
