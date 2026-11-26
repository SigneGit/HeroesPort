#include "cpu/x86_context.h"
#include "core/log.h"
#include "gpu/texture.h"
#include "xdk/hle.h"

#include <cstdlib>

bool HeroesHostGraphicsSetup(X86Context&, uint8_t*) {
    LOG_FIRST(1, "heroes: using host graphics setup for the title's direct GPU-register write");
    return true;
}

bool HeroesHostScreenCopy(X86Context& ctx, uint8_t*) {
    // At 65069: eax is the acquired destination surface, [esp+6C] the
    // acquired source, ebx the title texture object. Keep the original
    // lock/swizzle implementation for every path that consumes CPU pixels.
    static const bool original = std::getenv("HEROES_CPU_SCREEN_COPY") != nullptr;
    const uint32_t src = kernel::R32(ctx.esp + 0x6c), dst = ctx.eax;
    gpu::TextureDesc from, to;
    if (original || kernel::R32(ctx.ebx + 0x28) != 0x12 ||
        !gpu::Describe(src, from) || !gpu::Describe(dst, to) ||
        from.format != 0x12 || to.format != 0x12 || !from.linear || !to.linear ||
        from.data == to.data) return false;
    LOG_FIRST(4, "heroes: GPU screen copy %08X -> %08X, bypassing unused CPU locks", src, dst);
    // Same RECT and POINT the title passes at 650A5. GUEST_CALL preserves
    // registers; ebp must still be set for the original destination Release.
    GUEST_CALL(D3DDevice_CopyRects, ctx, {src, ctx.esp + 0x2c, 1, dst, ctx.esp + 0x14});
    ctx.ebp = dst;
    return true;
}
