// Exercise the actual host hooks against synthetic guest memory. No game
// executable, translated code or assets are linked into this test.
#include "common/cheats.cpp"
#include <cassert>

namespace { std::vector<uint8_t> guest(8*1024*1024); constexpr uint32_t hero=0x510000,enemy=0x540000; }
namespace kernel {
uint8_t* g_base=guest.data();
uint32_t CallGuest(X86Context& ctx,uint32_t fn,const uint32_t* args,size_t) {
    if(fn==heroes::GuestAddress(0x15000))return 0x12340000u|uint32_t(ctx.ecx==enemy);
    if(fn==heroes::GuestAddress(0xc5290)){
        for(uint32_t i=0;i<ReadField(ctx.ecx+0x2472,1);++i)
            if(kernel::R32(ctx.ecx+0x19c4+i*20)==args[0])return i;
        return UINT32_MAX;
    }
    if(fn==heroes::GuestAddress(0xd60d0)){
        const auto count=ReadField(ctx.ecx+0x2472,1);
        kernel::W32(ctx.ecx+0x19c4+count*20,args[0]);
        kernel::W32(ctx.ecx+0x19c8+count*20,args[1]);
        WriteField(ctx.ecx+0x2472,count+1,1);
    }
    return 0;
}
}
namespace mem {
bool IsCommitted(uint32_t va){return va>=0x10000&&va<guest.size();}
uint32_t AllocSystem(uint32_t,uint32_t){return 0x710000;}
}
namespace logx { void Write(Level,const char*,...){} }

int main(int argc, char**) {
    heroes::pal_image = argc > 1;
    auto put=[](uint32_t at,float v){std::memcpy(kernel::HostPtr(at),&v,4);};
    kernel::W32(PlayersRoot(),0x500000);kernel::W32(0x500014,0x600000);
    kernel::W32(0x600000+kPlayers,hero);kernel::W32(0x624680,0x650000);
    put(hero+0x74,90);put(hero+0x24ac,100);put(hero+0x24b0,10);put(hero+0x24b4,50);
    kernel::W32(hero+0x3b8+115*16,7);
    kernel::W32(hero+0x3c0+4*16,0x12345); // available melee action pointer
    X86Context ctx{};ctx.esp=0x700000;
    // Finisher meter is independent of mana and item quantities. Both selected
    // move slots work; borrowed charge never survives disable, save or copy.
    kernel::W32(hero+0x1afc,5);kernel::W32(hero+0x1b00,6);
    kernel::W32(hero+0x3c0+5*16,0x570000);
    put(hero+0x1b08,0.75f);heroes::unlimited_special_charges=true;
    HeroesCheatFrame(ctx,nullptr);assert(ReadFloat(hero+0x1b08)==0.75f);
    WriteField(0x570106,1,1);HeroesCheatFrame(ctx,nullptr);
    assert(ReadFloat(hero+0x1b08)==3);
    put(hero+0x1b08,0);HeroesCheatFrame(ctx,nullptr);
    assert(ReadFloat(hero+0x1b08)==3);
    heroes::unlimited_special_charges=false;HeroesCheatFrame(ctx,nullptr);
    assert(ReadFloat(hero+0x1b08)==0.75f);
    heroes::unlimited_special_charges=true;HeroesCheatFrame(ctx,nullptr);
    ctx.ecx=hero;HeroesCheatBeforeSave(ctx,nullptr);
    assert(ReadFloat(hero+0x1b08)==0.75f);
    HeroesCheatFrame(ctx,nullptr);kernel::W32(ctx.esp+4,hero);
    HeroesCheatBeforePlayerCopy(ctx,nullptr);assert(ReadFloat(hero+0x1b08)==0.75f);
    HeroesCheatFrame(ctx,nullptr);WriteField(0x570106,0,1);
    HeroesCheatFrame(ctx,nullptr);assert(ReadFloat(hero+0x1b08)==0.75f);
    kernel::W32(hero+0x3c0+6*16,0x570000);WriteField(0x570106,1,1);
    HeroesCheatFrame(ctx,nullptr);assert(ReadFloat(hero+0x1b08)==3);
    heroes::DisableCheats();HeroesCheatFrame(ctx,nullptr);
    assert(!heroes::unlimited_special_charges && ReadFloat(hero+0x1b08)==0.75f);
    heroes::temporary_health=true;heroes::temporary_items=true;heroes::temporary_moves=true;
    heroes::unlimited_mana=true;
    HeroesCheatFrame(ctx,nullptr);
    assert(ReadFloat(hero+0x24ac)==1000 && ReadFloat(hero+0x74)==990);
    assert(ReadFloat(hero+0x24b0)==50);
    assert(kernel::R32(hero+0x3b8+115*16)==1000);
    assert(int32_t(kernel::R32(hero+0x3b8))==-4);
    // Pickups accrue to the real baseline; spending borrowed stock does not.
    kernel::W32(hero+0x3b8+115*16,1003);HeroesCheatFrame(ctx,nullptr);
    kernel::W32(hero+0x3b8+115*16,999);HeroesCheatFrame(ctx,nullptr);
    ctx.ecx=hero;HeroesCheatBeforeSave(ctx,nullptr);
    assert(kernel::R32(hero+0x3b8+115*16)==10);
    assert(kernel::R32(hero+0x3b8)==0);
    assert(ReadFloat(hero+0x24ac)==100 && ReadFloat(hero+0x74)==90);
    // Copy hooks remove overlays even while their UI switches remain on.
    HeroesCheatFrame(ctx,nullptr);kernel::W32(ctx.esp+4,hero);
    HeroesCheatBeforePlayerCopy(ctx,nullptr);
    assert(kernel::R32(hero+0x3b8+115*16)==10);
    // Borrowed flags are not copied; a real flag setter is retained.
    heroes::temporary_gems=true;HeroesCheatFrame(ctx,nullptr);
    assert(ReadField(0x650000+0xe4+100*8,1)==1);
    ctx.edi=0x650000;ctx.esi=100;ctx.ebx=1;HeroesCheatQuestWrite(ctx,nullptr);
    HeroesCheatBeforeQuestCopy(ctx,nullptr);
    assert(ReadField(0x650000+0xe4+100*8,1)==1);
    assert(ReadField(0x650000+0xe4+102*8,1)==0);
    heroes::DisableCheats();HeroesCheatFrame(ctx,nullptr);
    assert(ReadFloat(hero+0x24ac)==100);
    assert(kernel::R32(hero+0x3c0+4*16)==0x12345); // never replace pointers
    heroes::god_mode=true;ctx.ecx=hero;assert(HeroesGodModeQuery(ctx,nullptr));
    ctx.ecx=enemy;assert(!HeroesGodModeQuery(ctx,nullptr));
    heroes::easy_blocking=true;ctx.esi=hero;ctx.top=3;ctx.st[3]=70;
    HeroesCheatDamageReduction(ctx,nullptr);assert(ctx.st[3]==88);
    ctx.st[3]=100;HeroesCheatDamageReduction(ctx,nullptr);assert(ctx.st[3]==100); // healing intact
    heroes::freeze_xp=true;ctx.ecx=hero;assert(HeroesCheatFreezeXP(ctx,nullptr));
    ctx.ecx=enemy;assert(!HeroesCheatFreezeXP(ctx,nullptr));
    heroes::one_hit_kill=true;kernel::W32(heroes::GuestAddress(0x49d158),0x300000);
    ctx.esi=enemy;ctx.edi=0x560000;kernel::W32(ctx.esp+12,hero);
    put(enemy+0x74,50);put(ctx.edi+0x1c,5);
    HeroesCheatOneHit(ctx,nullptr);assert(ReadFloat(enemy+0x74)==5);
    assert(ReadFloat(0x560000+0x1c)==5); // shared descriptor is unchanged
    put(enemy+0x74,50);kernel::W32(ctx.esp+12,0);HeroesCheatOneHit(ctx,nullptr);
    assert(ReadFloat(enemy+0x74)==50); // no unattended/environment kills
    ctx.esi=hero;kernel::W32(ctx.esp+12,hero);put(hero+0x74,90);
    HeroesCheatOneHit(ctx,nullptr);assert(ReadFloat(hero+0x74)==90);
    ctx.esi=enemy;ctx.ebx=0x560000;ctx.edi=0;kernel::W32(ctx.esp+0x1c,hero);
    put(enemy+0x74,100);HeroesCheatMonsterHit(ctx,nullptr);
    assert(ReadFloat(enemy+0x74)==5);
    kernel::W32(ctx.esp+0x1c,0);put(enemy+0x74,100);HeroesCheatMonsterHit(ctx,nullptr);
    assert(ReadFloat(enemy+0x74)==100);
    ctx.esi=0x550000;put(ctx.esi+0x74,100);kernel::W32(ctx.esp+0x1c,hero);
    HeroesCheatMonsterHit(ctx,nullptr);assert(ReadFloat(ctx.esi+0x74)==100);
    // A reused address starts fresh, rather than restoring the previous actor.
    heroes::temporary_items=true;HeroesCheatFrame(ctx,nullptr);
    ctx.ecx=hero;HeroesCheatNewPlayer(ctx,nullptr);
    kernel::W32(hero+0x3b8+115*16,2);
    heroes::temporary_items=false;HeroesCheatFrame(ctx,nullptr);
    assert(kernel::R32(hero+0x3b8+115*16)==2);
    // HUD preview removes only zero-strength records it created; an existing
    // buff and a legitimate replacement of a preview buff both survive.
    kernel::W32(hero+0x19c4,0x12);put(hero+0x19c8,5);WriteField(hero+0x2472,1,1);
    heroes::buff_preview=true;HeroesCheatFrame(ctx,nullptr);
    assert(ReadField(hero+0x2472,1)==9);
    put(hero+0x19c8+20,2);
    heroes::buff_preview=false;HeroesCheatFrame(ctx,nullptr);
    assert(ReadField(hero+0x2472,1)==2);
    assert(kernel::R32(hero+0x19c4)==0x12 && ReadFloat(hero+0x19c8)==5);
    heroes::buff_preview=true;HeroesCheatFrame(ctx,nullptr);
    ctx.ecx=hero;HeroesCheatBeforeSave(ctx,nullptr);
    assert(ReadField(hero+0x2472,1)==2);
}
