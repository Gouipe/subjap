# Enregistre le programme de mise à jour local (native messaging host
# « com.subjap.updater ») pour Chrome et Edge, pour l'utilisateur courant.
# Le bouton « Mettre à jour » de la popup l'utilise. Sans danger à relancer.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

$hostName = "com.subjap.updater"
# Identifiant fixé par la clé du manifeste (src/manifest.ts).
$extensionId = "cahpadjckhokgbglcanpijmloignnecd"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js est introuvable : impossible d'enregistrer le programme de mise à jour." }
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
$pathDirs = @((Split-Path -Parent $node))
if ($git) { $pathDirs += (Split-Path -Parent $git) }

$hostDir = Join-Path $env:LOCALAPPDATA "SubJap\native-host"
New-Item -ItemType Directory -Force $hostDir | Out-Null
$launcher = Join-Path $hostDir "subjap-updater.cmd"
$manifestPath = Join-Path $hostDir "$hostName.json"

# Chrome lance l'hôte avec son propre PATH, qui peut précéder l'installation de
# Node ou de Git : le lanceur fixe leurs dossiers. Il est lu en UTF-8 (chcp),
# pour un dossier utilisateur accentué ; rien ne doit sortir sur stdout.
$launcherContent = @(
    "@echo off",
    "chcp 65001 >nul",
    "set `"PATH=$($pathDirs -join ';');%PATH%`"",
    "`"$node`" `"$repo\scripts\native-host.mjs`" %*"
) -join "`r`n"
$manifest = [ordered]@{
    name            = $hostName
    description     = "Met à jour SubJap (git pull + build)"
    path            = $launcher
    type            = "stdio"
    allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json

$utf8 = New-Object System.Text.UTF8Encoding($false)
# Réécrit seulement si besoin : la mise à jour lancée par ce lanceur repasse ici.
function Write-IfChanged([string]$path, [string]$content, [System.Text.Encoding]$encoding) {
    if ((Test-Path $path) -and ([IO.File]::ReadAllText($path, $encoding) -eq $content)) { return }
    [IO.File]::WriteAllText($path, $content, $encoding)
}
Write-IfChanged $launcher ($launcherContent + "`r`n") $utf8
Write-IfChanged $manifestPath $manifest $utf8

foreach ($browser in @("Google\Chrome", "Microsoft\Edge")) {
    $key = "HKCU:\Software\$browser\NativeMessagingHosts\$hostName"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-Item -Path $key -Value $manifestPath
}
