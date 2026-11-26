#include "audio/buffer_notifications.h"
#include <cassert>
#include <vector>

int main() {
    const std::vector<audio::BufferNotification> notifications{{0,1},{5,2},{8,3},{audio::kNotifyStop,4}};
    std::vector<uint32_t> events;
    auto signal=[&](uint32_t e){events.push_back(e);};
    auto frame=[](uint32_t b){return double(b);};
    auto advance=[&](double a,double b,bool loop=false,double start=0){
        events.clear();audio::NotifyPlayback(notifications,a,b,10,start,loop,frame,signal);
    };
    advance(0,0);assert(events.empty());
    advance(0,1);assert((events==std::vector<uint32_t>{1}));
    advance(1,5);assert(events.empty());
    advance(5,6);assert((events==std::vector<uint32_t>{2}));
    advance(4.5,5.5);assert((events==std::vector<uint32_t>{2}));
    advance(7,10);assert((events==std::vector<uint32_t>{3}));
    advance(9,11,true);assert((events==std::vector<uint32_t>{1}));
    advance(9,10,true);assert(events.empty());
    advance(9,16,true);assert((events==std::vector<uint32_t>{1,2}));
    advance(9,36,true,3);assert((events==std::vector<uint32_t>{2,3}));
    advance(9,11,false);assert(events.empty());
    advance(8,7);assert(events.empty());
    events.clear();audio::NotifyStopped(notifications,signal);assert((events==std::vector<uint32_t>{4}));
    // ADPCM markers use compressed byte offsets, converted by the caller.
    const std::vector<audio::BufferNotification> compressed{{36,5},{72,6}};
    events.clear();audio::NotifyPlayback(compressed,63,65,192,0,false,
        [](uint32_t bytes){return double(bytes/36*64);},signal);
    assert((events==std::vector<uint32_t>{5}));
    // Markers before a selected play region are outside that region.
    events.clear();audio::NotifyPlayback(notifications,0,10,10,0,false,
        [](uint32_t bytes){return double(bytes)-5;},signal);
    assert((events==std::vector<uint32_t>{2,3}));
}
