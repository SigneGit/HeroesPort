param([switch]$Diagnostics,[switch]$Capture,[switch]$Performance,
      [ValidateSet('Off','Observe','Full')][string]$AnimationTest='Off')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$output=Join-Path $projectRoot 'native/out/build/release'
$executable=Join-Path $output 'Heroes.exe'
if (-not (Test-Path -LiteralPath $executable)) {throw 'Run tools/build-native.ps1 first.'}
$oldVerbose=$env:XBE_VERBOSE
$oldCapture=$env:XBE_CAPTURE_DIR
$oldPerformance=$env:XBE_PERF
$oldAnimation=$env:HEROES_ANIMATION_TEST
try {
    $env:HEROES_ANIMATION_TEST=$AnimationTest.ToLowerInvariant()
    if ($Diagnostics -or $Capture) {$env:XBE_VERBOSE='1'}
    if ($Performance) {$env:XBE_PERF='1';$env:XBE_VERBOSE='1'}
    if ($Capture) {
        $captureRoot=Join-Path $projectRoot 'local/native-analysis/gpu-captures'
        New-Item -ItemType Directory -Path $captureRoot -Force | Out-Null
        $env:XBE_CAPTURE_DIR=$captureRoot
    }
    $game=Start-Process -FilePath $executable -WorkingDirectory $output -WindowStyle Normal -PassThru
    $null=$game.Handle # Retain the handle so ExitCode survives a fast exit.
} finally {
    $env:XBE_VERBOSE=$oldVerbose
    $env:XBE_CAPTURE_DIR=$oldCapture
    $env:XBE_PERF=$oldPerformance
    $env:HEROES_ANIMATION_TEST=$oldAnimation
}
Write-Output "Heroes started (process $($game.Id)). Enter: Start; arrows: menu; Space: confirm; Backspace: back; WASD: move."
if ($Capture) {Write-Output "F3 captures a GPU frame under $captureRoot and dumps thread diagnostics."}
if ($AnimationTest -ne 'Off') {Write-Output "Animation test: $AnimationTest. Cadence reports are written to the game log every 120 presented frames."}
# Keep the launching command alive while the game runs. Managed command hosts
# can terminate their child process tree when a short-lived launcher exits.
# Waiting also makes an early startup failure visible instead of reporting
# successful gameplay merely because Start-Process returned a PID.
$game.WaitForExit()
if ($game.ExitCode -ne 0) {throw "Heroes exited with code $($game.ExitCode). See native/out/build/release/logs/heroes.log."}
