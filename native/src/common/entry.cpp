#include <windows.h>
#include <shellapi.h>
#include <filesystem>
#include <cstdio>
#include "../../launcher/process_args.h"

extern "C" int WINAPI HeroesGameMain(HINSTANCE, HINSTANCE, PWSTR, int);

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR command, int show) {
    int argc = 0;
    auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv || argc < 2 || std::wstring_view(argv[1]) != L"--prepare") {
        LocalFree(argv);
        return HeroesGameMain(instance, previous, command, show);
    }

    // The release's private Node runtime runs the same importer as the GUI.
    wchar_t module[32768];
    DWORD length = GetModuleFileNameW(nullptr, module, 32768);
    if (!length || length >= 32768) { LocalFree(argv); return 1; }
    const auto root = std::filesystem::path(module).parent_path();
    auto runtime = root / L"runtime/node.exe";
    std::wstring args = heroes::QuoteArgument(runtime.native()) + L" " +
        heroes::QuoteArgument((root / L"tools/portable-prepare.mjs").native());
    for (int i = 1; i < argc; ++i) args += L" " + heroes::QuoteArgument(argv[i]);
    LocalFree(argv);

    STARTUPINFOW startup{sizeof(startup)};
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(runtime.c_str(), args.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                        nullptr, root.c_str(), &startup, &process)) {
        std::fputs("Could not start the bundled preparation runtime. Extract the entire release again.\n", stderr);
        return 1;
    }
    CloseHandle(process.hThread);
    DWORD result = 1;
    WaitForSingleObject(process.hProcess, INFINITE);
    GetExitCodeProcess(process.hProcess, &result);
    CloseHandle(process.hProcess);
    return static_cast<int>(result);
}
