# Met à jour SubJap depuis le dépôt distant, puis recompile dist/.
# Lancé par « npm.cmd run update », par un double-clic sur mettre-a-jour.cmd ou
# par le bouton « Mettre à jour » de la popup (scripts/native-host.mjs, qui
# définit SUBJAP_PROGRESS et lit les lignes « ::subjap-… »).
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$progress = [bool]$env:SUBJAP_PROGRESS
if ($progress) { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) }

function Step([string]$name) {
    if ($progress) { Write-Host "::subjap-step $name" }
}

function Fail([string]$message) {
    if ($progress) { Write-Host "::subjap-error $message" }
    Write-Host ""
    Write-Host $message -ForegroundColor Red
    exit 1
}

Push-Location $repo
try {
    $before = git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { Fail "Ce dossier n'est pas un dépôt git : impossible de mettre à jour." }

    Step "pull"
    Write-Host "Récupération des nouveautés..." -ForegroundColor Cyan
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
        Fail ("La récupération a échoué : des fichiers ont été modifiés localement, " +
            "l'historique a divergé ou le réseau est indisponible. Rien n'a été écrasé.")
    }
    $after = git rev-parse HEAD

    $lockChanged = $false
    if ($before -ne $after) {
        $lockChanged = @(git diff --name-only $before $after) -contains "package-lock.json"
    }
    if ($lockChanged -or -not (Test-Path "node_modules")) {
        Step "deps"
        Write-Host ""
        Write-Host "Installation des dépendances..." -ForegroundColor Cyan
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) { Fail "L'installation des dépendances a échoué." }
    }

    Step "build"
    Write-Host ""
    Write-Host "Compilation de l'extension..." -ForegroundColor Cyan
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { Fail "La compilation a échoué." }

    # Le bouton « Mettre à jour » de la popup passe par ce programme local.
    try {
        & (Join-Path $PSScriptRoot "register-native-host.ps1")
    }
    catch {
        Write-Host ""
        Write-Host "Bouton « Mettre à jour » de la popup indisponible : $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # L'installation (install.ps1) donne ses propres dernières étapes.
    if ($env:SUBJAP_INSTALL) { exit 0 }

    Write-Host ""
    if ($before -eq $after) {
        Write-Host "Déjà à jour." -ForegroundColor Green
    }
    else {
        Write-Host "Nouveautés :" -ForegroundColor Green
        git log --reverse --format="  - %s" "$before..$after"
    }

    Write-Host ""
    Write-Host "Pour utiliser la nouvelle version :" -ForegroundColor Yellow
    Write-Host "  1. Dans chrome://extensions, cliquer sur Recharger sous SubJap."
    Write-Host "  2. Recharger les onglets vidéo déjà ouverts."
    Write-Host "  3. Si la page Options de SubJap est ouverte, la rafraîchir (F5)."

    # Vite lit l'endpoint IA dans ces fichiers (mode production) ou dans l'environnement.
    $envFiles = @(@(".env", ".env.local", ".env.production", ".env.production.local") |
        Where-Object { Test-Path $_ })
    $aiConfigured = [bool]$env:VITE_SUBJAP_AI_ENDPOINT -or ($envFiles.Count -gt 0 -and
        [bool](Select-String -Path $envFiles -Pattern '^\s*VITE_SUBJAP_AI_ENDPOINT\s*=\s*\S' -Quiet))
    if (-not $aiConfigured) {
        Write-Host ""
        Write-Host ("IA non configurée : le bouton « Enrichir avec l'IA » ne fonctionnera pas. " +
            "Créer .env.local (voir la section « IA facultative » du README).") -ForegroundColor Yellow
    }
    exit 0
}
finally {
    Pop-Location
}
