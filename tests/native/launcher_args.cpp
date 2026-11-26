#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include "process_args.h"
#include <cassert>
#include <vector>
int main(){
    for(const std::wstring value:std::vector<std::wstring>{L"",L"C:\\Game Files\\Heroes.iso",L"C:\\folder\\",L"quote\"inside",L"a&b $(test) 'file'",L"Unicode \u00e9 \u6e38\u620f.iso"}){
        auto cmd=L"program.exe "+heroes::QuoteArgument(value);int count=0;
        auto args=CommandLineToArgvW(cmd.c_str(),&count);assert(args&&count==2&&value==args[1]);LocalFree(args);
    }
}
