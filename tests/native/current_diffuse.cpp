#include "gpu/shaders.h"
#include <cassert>
#include <string>

int main() {
    // A disabled diffuse array must consume the current attribute, for world
    // billboards as well as pretransformed UI. An enabled array still wins.
    constexpr uint16_t position_uv = (1u << 0) | (1u << 9);
    for (bool screen : {false, true}) {
        auto constant = gpu::FixedVertexHlsl(position_uv, screen);
        assert(constant.find("oD0 = current_diffuse;") != std::string::npos);
        auto streamed = gpu::FixedVertexHlsl(position_uv | (1u << 3), screen);
        assert(streamed.find("oD0 = i.v3;") != std::string::npos);
    }
    // Synthetic MOV oD0, v3, identity swizzle. No original game instructions.
    std::vector<uint32_t> program{0, (1u << 21) | (3u << 9) | 0x1B,
                                  2u << 26, (15u << 12) | (1u << 11) | (3u << 3) | 1u};
    auto constant = gpu::VertexProgramHlsl(program, position_uv);
    assert(constant.find("(current_diffuse).xyzw") != std::string::npos);
    assert(constant.find("oD0.xyzw = mr.xyzw;") != std::string::npos);
    auto streamed = gpu::VertexProgramHlsl(program, position_uv | (1u << 3));
    assert(streamed.find("(i.v3).xyzw") != std::string::npos);
}
