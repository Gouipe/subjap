# Installe SubJap sur un PC Windows qui n'a rien, en une ligne PowerShell :
#   irm https://raw.githubusercontent.com/Gouipe/subjap/master/scripts/install.ps1 | iex
# Installe Git et Node.js si besoin (winget), clone SubJap dans %USERPROFILE%\SubJap
# (ou le met à jour s'il y est déjà), compile et enregistre le programme de mise
# à jour utilisé par la popup. Prévu pour « irm | iex » : enregistré sans BOM et
# exécuté dans un bloc, sans « exit », pour ne pas fermer la fenêtre PowerShell.
& {
    $ErrorActionPreference = "Continue"
    $repoUrl = "https://github.com/Gouipe/subjap.git"
    $target = Join-Path $HOME "SubJap"

    function Say([string]$message, [string]$color = "Cyan") {
        Write-Host ""
        Write-Host $message -ForegroundColor $color
    }

    function Update-SessionPath {
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [Environment]::GetEnvironmentVariable("Path", "User")
    }

    function Install-Tool([string]$command, [string]$wingetId, [string]$label) {
        if (Get-Command $command -ErrorAction SilentlyContinue) { return $true }
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            Say "$label est introuvable et winget n'est pas disponible sur ce PC. Installez $label, puis relancez cette commande." "Red"
            return $false
        }
        Say "Installation de $label (Windows peut demander une autorisation)..."
        winget install --id $wingetId --exact --source winget --accept-package-agreements --accept-source-agreements
        Update-SessionPath
        if (Get-Command $command -ErrorAction SilentlyContinue) { return $true }
        Say "L'installation de $label a échoué. Installez-le, puis relancez cette commande." "Red"
        return $false
    }

    if (-not (Install-Tool "git" "Git.Git" "Git")) { return }
    if (-not (Install-Tool "node" "OpenJS.NodeJS.LTS" "Node.js")) { return }

    $nodeVersion = (node --version).Trim()
    if ([int]($nodeVersion.TrimStart("v").Split(".")[0]) -lt 18) {
        Say "Node.js $nodeVersion est trop ancien. Mettez-le à jour avec « winget upgrade OpenJS.NodeJS.LTS », puis relancez cette commande." "Red"
        return
    }

    if (Test-Path (Join-Path $target ".git")) {
        Say "SubJap est déjà dans $target : mise à jour."
    }
    elseif ((Test-Path $target) -and (Get-ChildItem $target -Force | Select-Object -First 1)) {
        Say "Le dossier $target existe déjà et ne contient pas SubJap. Renommez-le, puis relancez cette commande." "Red"
        return
    }
    else {
        Say "Téléchargement de SubJap dans $target..."
        git clone $repoUrl $target
        if ($LASTEXITCODE -ne 0) {
            Say "Le téléchargement a échoué. Vérifiez la connexion, puis relancez cette commande." "Red"
            return
        }
    }

    $envFile = Join-Path $target ".env.local"
    if (-not (Test-Path $envFile)) {
        Say "Enrichissement par l'IA (facultatif)"
        Write-Host "Si l'on vous a donné l'adresse d'un Worker SubJap, collez-la ici. Sinon, appuyez sur Entrée."
        $url = "$(Read-Host "Adresse du Worker")".Trim()
        if ($url -match '^https://\S+$') {
            [IO.File]::WriteAllText($envFile, "VITE_SUBJAP_AI_ENDPOINT=$url`r`n", (New-Object System.Text.UTF8Encoding($false)))
        }
        elseif ($url) {
            Say "Adresse ignorée : elle doit commencer par https://. L'IA restera désactivée." "Yellow"
        }
    }

    $env:SUBJAP_INSTALL = "1"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target "scripts\update.ps1")
    $updateExit = $LASTEXITCODE
    Remove-Item Env:SUBJAP_INSTALL -ErrorAction SilentlyContinue
    if ($updateExit -ne 0) {
        Say "L'installation s'est arrêtée : voir le message ci-dessus." "Red"
        return
    }

    $dist = Join-Path $target "dist"
    Set-Clipboard -Value "chrome://extensions"
    Start-Process explorer.exe $dist

    Say "SubJap est prêt. Dernière étape, dans Chrome :" "Green"
    Write-Host "  1. Ouvrez un nouvel onglet et collez l'adresse déjà copiée : chrome://extensions"
    Write-Host "     (dans Edge : edge://extensions)."
    Write-Host "  2. Activez le « Mode développeur »."
    Write-Host "  3. Cliquez sur « Charger l'extension non empaquetée » et choisissez le dossier"
    Write-Host "     $dist"
    Write-Host "     (il vient de s'ouvrir dans l'Explorateur)."
    Write-Host ""
    Write-Host "Ensuite, la popup de SubJap signale les mises à jour et les installe d'un clic."
}
