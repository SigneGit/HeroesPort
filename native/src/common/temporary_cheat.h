#pragma once
#include <algorithm>
#include <cstdint>
#include <limits>

namespace heroes {
// A temporary count may be consumed without spending the real inventory.
// Positive changes (pickups) accrue to the baseline; synthetic stock never does.
struct TemporaryCount {
    bool active=false;
    int32_t baseline=0,last=0;
    void Observe(int32_t current, bool pickups) {
        if(active && pickups && current>last)
            baseline=int32_t(std::clamp<int64_t>(int64_t(baseline)+int64_t(current)-last,0,INT32_MAX));
    }
    int32_t Apply(int32_t current,int32_t requested,bool pickups=false) {
        if(!active){baseline=current;active=true;}else Observe(current,pickups);
        last=requested;return requested;
    }
    int32_t Restore(int32_t current,bool pickups=false) {
        if(!active)return current;
        Observe(current,pickups);active=false;return baseline;
    }
};
}
