$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$downloadDirectory = Join-Path $projectRoot 'local/native-tools'
New-Item -ItemType Directory -Force -Path $downloadDirectory | Out-Null
$installer = Join-Path $downloadDirectory 'vs_buildtools.exe'
Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_buildtools.exe' -OutFile $installer
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'The Visual Studio installer did not pass Microsoft signature verification.'
}
$installerArguments = @(
    '--quiet', '--wait', '--norestart', '--nocache',
    '--installPath', 'C:\BuildTools\Heroes',
    '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--includeRecommended',
    '--add', 'Microsoft.VisualStudio.Component.VC.Llvm.Clang',
    '--add', 'Microsoft.VisualStudio.Component.VC.Llvm.ClangToolset',
    '--add', 'Microsoft.VisualStudio.Component.VC.CMake.Project'
)
Write-Output 'Installing signed Microsoft C++ Build Tools, Clang, Windows SDK, CMake and Ninja.'
$installation = Start-Process -FilePath $installer -ArgumentList $installerArguments -PassThru -WindowStyle Hidden
while (-not $installation.HasExited) {
    Start-Sleep -Seconds 5
    $installation.Refresh()
}
if ($installation.ExitCode -notin @(0, 3010)) { throw "Build Tools installation failed: $($installation.ExitCode)" }
Write-Output "Build Tools installation finished with code $($installation.ExitCode)."
