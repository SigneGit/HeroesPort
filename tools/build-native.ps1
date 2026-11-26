param([ValidateSet('Configure','Build')][string]$Stage='Build', [switch]$LauncherOnly, [switch]$GameOnly)
$ErrorActionPreference = 'Stop'
if ($LauncherOnly -and $GameOnly) { throw 'Choose LauncherOnly or GameOnly, not both.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio C++ Build Tools are missing. See docs/NATIVE.md.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'No MSVC C++ toolchain was found.' }
$developerCommand = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
$environmentCommand = '""{0}" -arch=amd64 -host_arch=amd64 >nul && set"' -f $developerCommand
$developerEnvironment = & $env:COMSPEC /d /s /c $environmentCommand
if ($LASTEXITCODE -ne 0) { throw 'Could not load the Visual Studio development environment.' }
foreach ($line in $developerEnvironment) {
    $separator = $line.IndexOf('=')
    if ($separator -gt 0) { [Environment]::SetEnvironmentVariable($line.Substring(0,$separator),$line.Substring($separator+1),'Process') }
}
$cmakeDirectory = Join-Path $installation 'Common7/IDE/CommonExtensions/Microsoft/CMake'
$llvmDirectory = Join-Path $installation 'VC/Tools/Llvm/x64/bin'
$env:PATH = "$llvmDirectory;$(Join-Path $cmakeDirectory 'CMake/bin');$(Join-Path $cmakeDirectory 'Ninja');$env:PATH"
foreach ($tool in @('clang++','cmake','ninja')) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing $tool" } }
Push-Location $projectRoot
try {
    if (-not $LauncherOnly) {
        node tools/prepare-native.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Native profile preparation failed.' }
    }
    Push-Location (Join-Path $projectRoot 'native')
    try {
        $launcherMode = if ($LauncherOnly) { 'ON' } else { 'OFF' }
        cmake --preset release "-DHEROES_LAUNCHER_ONLY=$launcherMode"
        if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed.' }
        if ($Stage -eq 'Build') {
            if ($GameOnly) { cmake --build --preset release --target Heroes_code }
            else { cmake --build --preset release }
            if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
        }
    } finally { Pop-Location }
} finally { Pop-Location }
