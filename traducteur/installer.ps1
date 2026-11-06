# Installe le traducteur du site Liste sur ce PC (Windows + carte graphique NVIDIA).
# Peut être relancé sans risque : les étapes déjà faites sont sautées, et ça met à jour le traducteur.

# Les erreurs des programmes lancés sont vérifiées une par une (code de sortie).
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
function Info($message) { Write-Host "    $message" }
function Warn($message) { Write-Host "    [ATTENTION] $message" -ForegroundColor Yellow }
function Fail($message) {
    Write-Host "`n[ERREUR] $message" -ForegroundColor Red
    Write-Host "Envoie une capture de cette fenêtre si tu bloques."
    exit 1
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Winget-Install($id, $extra = @()) {
    & winget install -e --id $id --accept-package-agreements --accept-source-agreements @extra
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { Fail "L'installation de $id a échoué (code $LASTEXITCODE)." }
    Refresh-Path
}

# ---------- 1. Carte graphique ----------
Step 'Carte graphique NVIDIA'
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $smi) { Fail "Pilote NVIDIA introuvable. Installe le pilote de ta carte depuis https://www.nvidia.com/fr-fr/drivers/ puis relance." }
$gpu = (& nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader) | Select-Object -First 1
Info $gpu
$driver = [double](($gpu -split ',')[1].Trim() -replace '^(\d+\.\d+).*', '$1')
if ($driver -lt 560) { Warn "Ton pilote NVIDIA ($driver) est ancien : mets-le à jour (version 560 ou plus) pour que CUDA fonctionne." }

# ---------- 2. Outils ----------
Step 'Outils nécessaires : Python 3.12, Git, outils de compilation C++'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "winget est introuvable. Installe « Programme d'installation d'application » depuis le Microsoft Store, puis relance."
}

# Trouve Python 3.12 : lanceur « py » ou installation par utilisateur.
function Find-Python {
    $direct = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (Test-Path $direct) { return $direct }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $path = (& py -3.12 -c "import sys; print(sys.executable)" 2>&1 | Select-Object -Last 1)
        if ($LASTEXITCODE -eq 0 -and $path -and (Test-Path $path)) { return $path }
    }
    return $null
}
$python = Find-Python
if (-not $python) {
    Info 'Installation de Python 3.12...'
    Winget-Install 'Python.Python.3.12' @('--scope', 'user')
    $python = Find-Python
    if (-not $python) { Fail 'Python 3.12 est installé mais introuvable. Redémarre le PC puis relance installer.bat.' }
}
Info ("Python : " + (& $python --version))

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Info 'Installation de Git...'
    Winget-Install 'Git.Git'
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $env:Path += ';C:\Program Files\Git\cmd' }
}
Info ("Git : " + (& git --version))

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$hasVc = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasVc) {
    Info 'Installation des outils de compilation C++ de Microsoft (long, accepte la demande administrateur)...'
    Winget-Install 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
} else {
    Info 'Outils de compilation C++ : déjà installés'
}

# ---------- 3. manga-image-translator ----------
Step 'Téléchargement de manga-image-translator'
if (Test-Path 'mit\.git') {
    & git -C mit pull --ff-only
} else {
    & git clone --depth 1 https://github.com/zyddnys/manga-image-translator mit
}
if ($LASTEXITCODE -ne 0) { Fail 'Téléchargement de manga-image-translator impossible.' }

# ---------- 4. Environnement Python ----------
Step 'Environnement Python'
if (-not (Test-Path 'venv\Scripts\python.exe')) {
    & $python -m venv venv
    if ($LASTEXITCODE -ne 0) { Fail "Création de l'environnement Python impossible." }
}
$vpy = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'
& $vpy -m pip install --upgrade pip wheel setuptools
if ($LASTEXITCODE -ne 0) { Fail 'Mise à jour de pip impossible.' }

# ---------- 5. PyTorch avec CUDA ----------
Step 'PyTorch pour carte NVIDIA (gros téléchargement, environ 3 Go)'
$torch = (Select-String -Path 'mit\requirements.txt' -Pattern '^torch==(.+)$').Matches[0].Groups[1].Value
$vision = (Select-String -Path 'mit\requirements.txt' -Pattern '^torchvision==(.+)$').Matches[0].Groups[1].Value
$installed = $false
foreach ($cuda in @('cu126', 'cu128', 'cu130')) {
    Info "Essai avec CUDA $cuda (torch $torch)..."
    & $vpy -m pip install "torch==$torch" "torchvision==$vision" --index-url "https://download.pytorch.org/whl/$cuda"
    if ($LASTEXITCODE -eq 0) { $installed = $true; break }
}
if (-not $installed) { Fail "PyTorch avec CUDA n'a pas pu être installé." }

# ---------- 6. Dépendances ----------
Step 'Dépendances du traducteur (plusieurs minutes)'
& $vpy -m pip install -r 'mit\requirements.txt'
if ($LASTEXITCODE -ne 0) { Fail "Installation des dépendances impossible (souvent : outils C++ manquants, redémarre le PC puis relance)." }
& $vpy -m pip install requests pillow
if ($LASTEXITCODE -ne 0) { Fail 'Installation de requests/pillow impossible.' }

Step 'Vérification de CUDA'
$check = & $vpy -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
if ($check[0] -ne 'True') { Warn "PyTorch ne voit pas la carte NVIDIA : la traduction marchera mais très lentement. Mets à jour le pilote NVIDIA." }
else { Info "Carte utilisée : $($check[1])" }

# ---------- 7. Police ----------
Step 'Police pour le texte en français'
New-Item -ItemType Directory -Force -Path 'fonts' | Out-Null
if (-not (Test-Path 'fonts\ComicNeue-Bold.ttf')) {
    try {
        Invoke-WebRequest 'https://raw.githubusercontent.com/google/fonts/main/ofl/comicneue/ComicNeue-Bold.ttf' -OutFile 'fonts\ComicNeue-Bold.ttf' -UseBasicParsing
        Info 'Police Comic Neue installée'
    } catch {
        Warn 'Police non téléchargée : le traducteur utilisera sa police par défaut.'
    }
} else { Info 'Police déjà présente' }

# ---------- 8. Configuration ----------
Step 'Configuration'
if (-not (Test-Path 'config.json')) {
    & $vpy worker.py --setup
    if ($LASTEXITCODE -ne 0) { Fail 'Configuration interrompue. Relance installer.bat.' }
} else {
    Info 'Déjà configuré (pour changer la clé DeepL ou le code : configurer.bat)'
}

Write-Host "`nInstallation terminée. Lance le traducteur avec lancer.bat." -ForegroundColor Green
