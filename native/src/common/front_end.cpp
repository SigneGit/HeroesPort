#include "region.h"
#include "front_end.h"
#include "cpu/x86_context.h"
#include "kernel/kernel.h"
#include "kernel/memory.h"
#include "core/log.h"

namespace {
// Canonical USA addresses are resolved to PAL after image loading.
uint32_t MainMenu() { return heroes::GuestAddress(0x322388); }
uint32_t Screens() { return heroes::GuestAddress(0x499500); }
bool Readable(uint32_t address, uint32_t bytes) {
    if (address < mem::kUserLow || !bytes || uint64_t(address)+bytes > UINT32_MAX) return false;
    const uint32_t last = (address+bytes-1)&~(mem::kPage-1);
    for (uint32_t page=address&~(mem::kPage-1);;page+=mem::kPage) {
        if (!mem::IsCommitted(page)) return false;
        if (page==last) return true;
    }
}
}

void HeroesMainMenuFrame(X86Context& ctx, uint8_t*) {
    bool active=false;
    if (ctx.ecx==MainMenu() && Readable(MainMenu(),6) && Readable(Screens(),0x84)) {
        const auto count=kernel::R32(Screens()+0x80);
        active=static_cast<uint8_t*>(kernel::HostPtr(MainMenu()))[5]!=0 && count<=16 &&
               (count==0 || kernel::R32(Screens()+(count-1)*8)==MainMenu());
    }
    if (heroes::main_menu_active.exchange(active)!=active)
        LOGR("heroes: main menu exit prompt %s",active?"available":"inactive");
}

void HeroesMainMenuHidden(X86Context& ctx, uint8_t*) {
    if (ctx.ecx==MainMenu()) heroes::main_menu_active=false;
}
void HeroesScreenOpened(X86Context&, uint8_t*) { heroes::main_menu_active=false; }

bool HeroesBootMovie(X86Context& ctx, uint8_t*) {
    heroes::main_menu_active=false;
    if (!heroes::skip_boot_videos.load() || !Readable(ctx.esp,16) || !Readable(ctx.esi,0x171)) return false;
    // C46E7 follows the three saved-register pushes and ESI=ECX, EDI=0.
    // Only these four return sites belong to the boot sequence in C4860.
    // Story movies, the opening cinematic and attract mode use other callers.
    const auto caller=kernel::R32(ctx.esp+12);
    if (caller!=heroes::GuestAddress(0xc49a5) && caller!=heroes::GuestAddress(0xc4a01) && caller!=heroes::GuestAddress(0xc4a2b) && caller!=heroes::GuestAddress(0xc4a55)) return false;
    static_cast<uint8_t*>(kernel::HostPtr(ctx.esi))[0x170]=0;
    LOGR("heroes: skipped boot video at caller %08X",caller);
    // Resume the original EAX=EDI/pop/pop/pop/ret 8 epilogue.
    return true;
}
