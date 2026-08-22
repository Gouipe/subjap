param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-z]{32}$")]
  [string]$ExtensionId,
  [string]$VoicevoxPath
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$hostSource = Join-Path $projectRoot "native-host\subjap-voicevox-host.ps1"
$installRoot = Join-Path $env:LOCALAPPDATA "SubJap\native-host"
$hostScript = Join-Path $installRoot "subjap-voicevox-host.ps1"
$manifestPath = Join-Path $installRoot "com.subjap.voicevox.json"

if (-not $VoicevoxPath) {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} "VOICEVOX\VOICEVOX.exe"),
    (Join-Path ${env:LOCALAPPDATA} "Programs\VOICEVOX\VOICEVOX.exe"),
    (Join-Path ${env:LOCALAPPDATA} "VOICEVOX\VOICEVOX.exe")
  )
  $VoicevoxPath = $candidates | Where-Object {
    Test-Path -LiteralPath $_ -PathType Leaf
  } | Select-Object -First 1
}

if (-not $VoicevoxPath -or -not (Test-Path -LiteralPath $VoicevoxPath -PathType Leaf)) {
  throw "VOICEVOX.exe introuvable. Relance avec -VoicevoxPath 'C:\chemin\VOICEVOX.exe'."
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Copy-Item -LiteralPath $hostSource -Destination $hostScript -Force

$powershellPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$nativeManifest = @{
  name = "com.subjap.voicevox"
  description = "SubJap local VOICEVOX launcher"
  path = $powershellPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
  args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $hostScript,
    "-VoicevoxPath",
    $VoicevoxPath
  )
}
$manifestJson = $nativeManifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText(
  $manifestPath,
  $manifestJson,
  (New-Object Text.UTF8Encoding($false))
)

$registryLocations = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.subjap.voicevox",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.subjap.voicevox"
)
foreach ($location in $registryLocations) {
  New-Item -Force -Path $location | Out-Null
  Set-ItemProperty -Path $location -Name "(default)" -Value $manifestPath
}

Write-Host "SubJap Native Messaging installé."
Write-Host "VOICEVOX: $VoicevoxPath"
Write-Host "Extension autorisée: $ExtensionId"
