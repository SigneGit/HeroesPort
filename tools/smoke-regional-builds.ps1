param(
    [string]$Directory = 'local/regional-test-builds',
    [ValidateRange(1,60)][int]$Seconds = 45,
    [string[]]$Regions = @('Europe','France','Italy','Spain')
)
$ErrorActionPreference = 'Stop'
$buildRoot = (Resolve-Path -LiteralPath $Directory).Path
$results = @()
foreach ($region in $Regions) {
    $regionRoot = Join-Path $buildRoot $region
    $log = Join-Path $regionRoot 'logs/heroes.log'
    $stderr = Join-Path $regionRoot 'logs/startup-smoke-stderr.log'
    $started = [DateTime]::UtcNow
    $run = Start-Process -FilePath (Join-Path $regionRoot 'Heroes.exe') -WorkingDirectory $regionRoot -WindowStyle Hidden -RedirectStandardError $stderr -PassThru
    $null = $run.Handle
    $menu = $false
    try {
        while (-not $run.HasExited -and ([DateTime]::UtcNow - $started).TotalSeconds -lt $Seconds) {
            if (Test-Path -LiteralPath $log) {
                $logFile = Get-Item -LiteralPath $log
                if ($logFile.LastWriteTimeUtc -ge $started -and
                    (Get-Content -LiteralPath $log -Raw) -match 'heroes: main menu exit prompt available') {
                    $menu = $true
                    break
                }
            }
            Start-Sleep -Milliseconds 200
            $run.Refresh()
        }
        $alive = -not $run.HasExited
        $result = [ordered]@{
            region = $region
            reachedMainMenu = $menu
            runningAtMainMenu = $alive -and $menu
            seconds = [Math]::Round(([DateTime]::UtcNow - $started).TotalSeconds,2)
            earlyExitCode = $(if ($alive) { $null } else { $run.ExitCode })
            log = $log
        }
        $results += $result
        $result | ConvertTo-Json -Compress
    } finally {
        # Stop only the test process started by this iteration.
        if (-not $run.HasExited) { Stop-Process -Id $run.Id; $run.WaitForExit() }
        $run.Dispose()
    }
}
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $buildRoot 'startup-smoke.json')
if (@($results | Where-Object { -not $_.runningAtMainMenu }).Count) { exit 1 }
