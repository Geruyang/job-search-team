$ErrorActionPreference = 'Stop'
$bridgeRoot = $PSScriptRoot
$bridgeNode = (Get-Command node -ErrorAction Stop).Source
$bridgeState = Join-Path $bridgeRoot '.local'
New-Item -ItemType Directory -Path $bridgeState -Force | Out-Null
$bridgeHealth = $null
try { $bridgeHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:17373/health' -TimeoutSec 2 } catch {}
if ($bridgeHealth) {
    if ($bridgeHealth.service -eq 'resume-browser-bridge') {
        Write-Output 'Bridge already running. Use node cli.mjs status to inspect it.'
        exit 0
    }
    throw 'Port 17373 is used by another service. No process was stopped.'
}
$bridgeScript = Join-Path $bridgeRoot 'server.mjs'
$bridgeProcess = Start-Process -FilePath $bridgeNode -ArgumentList @(('"{0}"' -f $bridgeScript)) -WorkingDirectory $bridgeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $bridgeState 'server.stdout.log') -RedirectStandardError (Join-Path $bridgeState 'server.stderr.log')
$bridgeProcess.Id | Set-Content -LiteralPath (Join-Path $bridgeState 'server.pid') -Encoding utf8
for ($bridgeAttempt=0; $bridgeAttempt -lt 20; $bridgeAttempt++) {
    Start-Sleep -Milliseconds 250
    if ($bridgeProcess.HasExited) { throw 'Bridge exited. Inspect .local/server.stderr.log.' }
    try { $bridgeHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:17373/health' -TimeoutSec 1 } catch { continue }
    if ($bridgeHealth.service -eq 'resume-browser-bridge') {
        Write-Output 'Bridge ready on 127.0.0.1:17373; no browser connected yet.'
        Write-Output ('Pairing file: ' + (Join-Path $bridgeState 'extension-pairing.json'))
        exit 0
    }
}
throw 'Bridge did not become ready. Inspect .local/server.stderr.log.'
