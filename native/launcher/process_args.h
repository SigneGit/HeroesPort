#pragma once
#include <string>
#include <string_view>
namespace heroes {
inline std::wstring QuoteArgument(std::wstring_view value) {
    std::wstring out=L"\"";size_t slashes=0;
    for(wchar_t c:value){if(c==L'\\'){slashes++;continue;}out.append(slashes*(c==L'"'?2:1),L'\\');slashes=0;if(c==L'"')out+=L'\\';out+=c;}
    out.append(slashes*2,L'\\');return out+L'"';
}
}
