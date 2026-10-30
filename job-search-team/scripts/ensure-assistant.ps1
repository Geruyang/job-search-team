param([Parameter(Mandatory=$true)][string]$Workspace, [string]$BridgeRoot, [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$arguments = @((Join-Path $PSScriptRoot 'ensure-assistant.mjs'), '--workspace', $Workspace)
if ($BridgeRoot) { $arguments += @('--bridge-root', $BridgeRoot) }
if ($PrepareOnly) { $arguments += '--prepare-only' }
& $nodePath @arguments
if ($LASTEXITCODE -ne 0) { throw "Assistant setup failed with exit code $LASTEXITCODE" }
