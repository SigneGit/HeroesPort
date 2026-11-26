#pragma once
#include <atomic>
namespace heroes {
inline std::atomic<bool> main_menu_active{false};
inline std::atomic<bool> exit_prompt_open{false};
inline std::atomic<bool> skip_boot_videos{false};
}
