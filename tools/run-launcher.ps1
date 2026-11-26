$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$executable=Join-Path $projectRoot 'native/out/build/release/HeroesLauncher.exe'
if (Test-Path -LiteralPath (Join-Path $projectRoot 'release/HeroesLauncher.exe')) {
    $executable=Join-Path $projectRoot 'release/HeroesLauncher.exe'
}
if (-not (Test-Path -LiteralPath $executable)) {throw 'Run tools/build-native.ps1 first.'}
Start-Process -FilePath $executable -WorkingDirectory (Split-Path $executable -Parent) -WindowStyle Normal
