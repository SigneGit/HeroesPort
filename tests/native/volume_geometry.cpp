#include "kernel/volume_geometry.h"
#include <cassert>
#include <limits>

int main() {
    using kernel::MakeVolumeGeometry;
    constexpr uint64_t unit = kernel::VolumeGeometry::unit_bytes;
    // Heroes keeps only the low 32 bits of GetDiskFreeSpaceEx's byte counts.
    auto large = MakeVolumeGeometry(2ull << 40, 8ull << 30);
    assert(large.total_units * unit < (1ull << 32));
    assert(uint32_t(large.available_units * unit) / unit == large.available_units);
    assert(large.available_units > 0);
    auto small = MakeVolumeGeometry(100 * unit, 7 * unit + unit - 1);
    assert(small.total_units == 100 && small.available_units == 7);
    assert(MakeVolumeGeometry(100 * unit, 0).available_units == 0);
    assert(MakeVolumeGeometry(100 * unit, unit - 1).available_units == 0);
    assert(MakeVolumeGeometry(0, 0).total_units == 0);
    assert(MakeVolumeGeometry(2 * unit, 10 * unit).available_units == 2);
    auto max = MakeVolumeGeometry(std::numeric_limits<uint64_t>::max(), std::numeric_limits<uint64_t>::max());
    assert(max.total_units == large.total_units && max.available_units <= max.total_units);
}
