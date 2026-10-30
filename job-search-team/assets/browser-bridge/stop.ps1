$ErrorActionPreference = 'Stop'
$bridgeRoot = $PSScriptRoot
$bridgePidFile = Join-Path $bridgeRoot '.local/server.pid'
if (-not (Test-Path -LiteralPath $bridgePidFile)) { Write-Output 'No managed bridge PID found.'; exit 0 }
$bridgePid = [int](Get-Content -LiteralPath $bridgePidFile -Raw).Trim()
$bridgeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $bridgePid"
if (-not $bridgeProcess) { Write-Output 'Bridge already stopped.'; exit 0 }
$bridgeScript = Join-Path $bridgeRoot 'server.mjs'
if ($bridgeProcess.Name -ne 'node.exe' -or -not $bridgeProcess.CommandLine.Contains($bridgeScript)) { throw 'PID no longer belongs to this bridge. Refusing to stop another process.' }
Stop-Process -Id $bridgePid
Write-Output 'Bridge stopped. Review any dispatched operation before restarting; no operation is automatically retried.'
