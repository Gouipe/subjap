# Met à jour SubJap depuis le dépôt distant, puis recompile dist/.
# Lancé par « npm.cmd run update » ou par un double-clic sur mettre-a-jour.cmd.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot

function Fail([string]$message) {
    Write-Host ""
    Write-Host $message -ForegroundColor Red
    exit 1
}

Push-Location $repo
try {
    $before = git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { Fail "Ce dossier n'est pas un dépôt git : impossible de mettre à jour." }

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
        Write-Host ""
        Write-Host "Installation des dépendances..." -ForegroundColor Cyan
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) { Fail "L'installation des dépendances a échoué." }
    }

    Write-Host ""
    Write-Host "Compilation de l'extension..." -ForegroundColor Cyan
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { Fail "La compilation a échoué." }

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
}
finally {
    Pop-Location
}
