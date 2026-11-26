#include "common/front_end.cpp"
#include <cassert>
#include <cstring>
#include <vector>

namespace { std::vector<uint8_t> guest(8*1024*1024); }
namespace kernel { uint8_t* g_base=guest.data(); }
namespace mem { bool IsCommitted(uint32_t va) { return va>=kUserLow&&va<guest.size(); } }
namespace logx { void Write(Level,const char*,...) {} }

int main() {
    X86Context ctx{};ctx.ecx=0x322388;
    guest[0x32238d]=1;
    HeroesMainMenuFrame(ctx,nullptr);assert(heroes::main_menu_active);
    kernel::W32(0x499580,1);kernel::W32(0x499500,0x322388);
    HeroesMainMenuFrame(ctx,nullptr);assert(heroes::main_menu_active);
    kernel::W32(0x499500,0x510000);
    HeroesMainMenuFrame(ctx,nullptr);assert(!heroes::main_menu_active);
    kernel::W32(0x499580,17);
    HeroesMainMenuFrame(ctx,nullptr);assert(!heroes::main_menu_active);
    kernel::W32(0x499580,0);guest[0x32238d]=0;
    HeroesMainMenuFrame(ctx,nullptr);assert(!heroes::main_menu_active);
    guest[0x32238d]=1;HeroesMainMenuFrame(ctx,nullptr);
    ctx.ecx=0x510000;HeroesMainMenuHidden(ctx,nullptr);assert(heroes::main_menu_active);
    ctx.ecx=0x322388;HeroesMainMenuHidden(ctx,nullptr);assert(!heroes::main_menu_active);
    HeroesMainMenuFrame(ctx,nullptr);HeroesScreenOpened(ctx,nullptr);assert(!heroes::main_menu_active);

    ctx.esi=0x520000;ctx.esp=0x530000;ctx.eax=0x12345678;ctx.top=2;ctx.st[2]=0.125;
    for(auto caller:{0xc49a5u,0xc4a01u,0xc4a2bu,0xc4a55u}) {
        kernel::W32(ctx.esp+12,caller);guest[ctx.esi+0x170]=1;
        const auto registers=ctx;const auto before=guest;
        heroes::skip_boot_videos=false;assert(!HeroesBootMovie(ctx,nullptr));assert(guest==before);
        heroes::skip_boot_videos=true;assert(HeroesBootMovie(ctx,nullptr));
        auto expected=before;expected[ctx.esi+0x170]=0;
        assert(guest==expected);assert(std::memcmp(&ctx,&registers,sizeof(ctx))==0);
    }
    for(auto caller:{0x3cf01u,0x3cba5u,0x12345678u}) {
        kernel::W32(ctx.esp+12,caller);guest[ctx.esi+0x170]=1;
        const auto before=guest;assert(!HeroesBootMovie(ctx,nullptr));assert(guest==before);
    }
    ctx.esi=UINT32_MAX;assert(!HeroesBootMovie(ctx,nullptr));
    ctx.esp=UINT32_MAX;assert(!HeroesBootMovie(ctx,nullptr));
}
