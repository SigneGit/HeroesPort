param([ValidateRange(1,60)][int]$Seconds=15)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$output=Join-Path $projectRoot 'native/out/build/release'
$executable=Join-Path $output 'Heroes.exe'
if (-not (Test-Path -LiteralPath $executable)) {throw 'Build Heroes.exe first.'}
$stderr=Join-Path $projectRoot 'local/native-analysis/boot-stderr.log'
$run=Start-Process -FilePath $executable -WorkingDirectory $output -WindowStyle Hidden -RedirectStandardError $stderr -PassThru
$null=$run.Handle # Retain the handle so ExitCode survives a fast process exit.
$runId=$run.Id
$deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
while (-not $run.HasExited -and [DateTime]::UtcNow -lt $deadline) {Start-Sleep -Milliseconds 250;$run.Refresh()}
$timedOut=-not $run.HasExited
if ($timedOut) {
    Stop-Process -Id $runId -ErrorAction SilentlyContinue;$run.WaitForExit()
}
else {$run.WaitForExit()}
$report=@{processId=$runId;seconds=$Seconds;stoppedAtTimeout=$timedOut;exitCode=$run.ExitCode;log=Join-Path $output 'logs/heroes.log'}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'local/native-analysis/boot-result.json')
$report | ConvertTo-Json
if (Test-Path -LiteralPath $report.log) {Get-Content -LiteralPath $report.log -Tail 35}
elseif (Test-Path -LiteralPath $stderr) {Get-Content -LiteralPath $stderr -Tail 15}
if ($timedOut) {exit 2}
if ($run.ExitCode -ne 0) {exit 1}
