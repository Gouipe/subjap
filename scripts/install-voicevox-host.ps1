param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-z]{32}$")]
  [string]$ExtensionId,
  [string]$VoicevoxPath
)

$ErrorActionPreference = "Stop"
$githubApiHeaders = @{
  Accept = "application/vnd.github+json"
  "User-Agent" = "SubJap-Voicevox-Installer"
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$hostSource = Join-Path $projectRoot "native-host\subjap-voicevox-host.ps1"
$installRoot = Join-Path $env:LOCALAPPDATA "SubJap\native-host"
$hostScript = Join-Path $installRoot "subjap-voicevox-host.ps1"
$manifestPath = Join-Path $installRoot "com.subjap.voicevox.json"

function Find-VoicevoxEngine {
  $candidates = @(
    (Join-Path ${env:LOCALAPPDATA} "Programs\VOICEVOX\vv-engine\run.exe"),
    (Join-Path ${env:LOCALAPPDATA} "Programs\VOICEVOX\VOICEVOX.exe"),
    (Join-Path ${env:ProgramFiles} "VOICEVOX\vv-engine\run.exe"),
    (Join-Path ${env:ProgramFiles} "VOICEVOX\VOICEVOX.exe"),
    (Join-Path ${env:LOCALAPPDATA} "VOICEVOX\vv-engine\run.exe"),
    (Join-Path ${env:LOCALAPPDATA} "VOICEVOX\VOICEVOX.exe")
  )
  return $candidates | Where-Object {
    Test-Path -LiteralPath $_ -PathType Leaf
  } | Select-Object -First 1
}

function Install-Voicevox {
  Write-Host "VOICEVOX absent : récupération de la dernière version CPU officielle..."
  $release = Invoke-RestMethod `
    -Headers $githubApiHeaders `
    -Uri "https://api.github.com/repos/VOICEVOX/voicevox/releases/latest"
  $asset = $release.assets | Where-Object {
    $_.name -match '^VOICEVOX-CPU\.Web\.Setup\..+\.exe$'
  } | Select-Object -First 1
  if (-not $asset) {
    throw "Impossible de trouver l'installateur Windows CPU dans la release VOICEVOX $($release.tag_name)."
  }

  $installerPath = Join-Path $env:TEMP "subjap-voicevox-$($release.tag_name).exe"
  try {
    Invoke-WebRequest `
      -Headers $githubApiHeaders `
      -Uri $asset.browser_download_url `
      -OutFile $installerPath
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
      throw "Le téléchargement de l'installateur VOICEVOX a échoué."
    }

    Write-Host "Installation de VOICEVOX $($release.tag_name)..."
    $process = Start-Process `
      -FilePath $installerPath `
      -ArgumentList @("/S") `
      -Wait `
      -PassThru
    if ($process.ExitCode -ne 0) {
      throw "L'installateur VOICEVOX a échoué avec le code $($process.ExitCode)."
    }
  } finally {
    if (Test-Path -LiteralPath $installerPath -PathType Leaf) {
      Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
    }
  }

  $deadline = [DateTime]::UtcNow.AddMinutes(2)
  do {
    $path = Find-VoicevoxEngine
    if ($path) { return $path }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "VOICEVOX est installé mais son moteur vv-engine/run.exe est introuvable."
}

if (-not $VoicevoxPath) {
  $VoicevoxPath = Find-VoicevoxEngine
}
if (-not $VoicevoxPath) {
  $VoicevoxPath = Install-Voicevox
}
if (-not (Test-Path -LiteralPath $VoicevoxPath -PathType Leaf)) {
  throw "Moteur VOICEVOX introuvable : $VoicevoxPath"
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
