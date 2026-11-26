#pragma once
#include <algorithm>
#include <cstdint>

namespace kernel {
struct VolumeGeometry {
    uint64_t total_units, available_units;
    static constexpr uint32_t sectors_per_unit = 32, bytes_per_sector = 512;
    static constexpr uint64_t unit_bytes = sectors_per_unit * bytes_per_sector;
};

// FATX-facing capacity must fit the 32-bit byte arithmetic used by some XAPI
// clients (including Heroes). Round down, and never promise unavailable host space.
inline VolumeGeometry MakeVolumeGeometry(uint64_t capacity, uint64_t available) {
    constexpr uint64_t max_bytes = 0xFFFFC000ull;
    uint64_t total = std::min(capacity, max_bytes) / VolumeGeometry::unit_bytes;
    return {total, std::min(available / VolumeGeometry::unit_bytes, total)};
}
}  // namespace kernel
