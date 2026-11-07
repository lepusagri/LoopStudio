param(
    [string]$Runtime = (Join-Path $PSScriptRoot 'LoopStudio-tools-runtime'),
    [string]$Python = '',
    [switch]$SkipOmr
)
$ErrorActionPreference = 'Stop'
$Runtime = [IO.Path]::GetFullPath($Runtime)
New-Item -ItemType Directory -Force $Runtime | Out-Null
$venvPython = Join-Path $Runtime 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    if ($Python) { & $Python -m venv $Runtime }
    else { & py -3.12 -m venv $Runtime }
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 erforderlich. Alternativ -Python <python.exe> angeben.' }
}
& $venvPython -c 'import sys; assert sys.version_info[:2] == (3,12), "Python 3.12 erforderlich"'
if ($LASTEXITCODE -ne 0) { throw 'Bitte einen neuen Laufzeitordner mit Python 3.12 verwenden.' }
& $venvPython -m pip install --disable-pip-version-check 'numpy==1.26.4' 'Pillow==13.0.0' 'pdfplumber==0.11.10' 'PyGuitarPro==0.9.3' 'onnxruntime==1.31.1' 'opencv-python==4.11.0.86' 'rapidocr-onnxruntime==1.4.4' 'pyclipper==1.4.0' 'Shapely==2.1.2' 'PyYAML==6.0.3'
if ($LASTEXITCODE -ne 0) { throw 'Die PDF-Werkzeugpakete konnten nicht installiert werden.' }

function Get-VerifiedFile([string]$Url, [string]$Destination, [string]$Sha256) {
    if ((Test-Path -LiteralPath $Destination) -and (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256) { return }
    New-Item -ItemType Directory -Force (Split-Path $Destination -Parent) | Out-Null
    $part = "$Destination.part"
    & curl.exe -fL --retry 3 --connect-timeout 20 $Url -o $part
    if ($LASTEXITCODE -ne 0) { throw "Download fehlgeschlagen: $Url" }
    if ((Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash -ne $Sha256) { throw "Pruefsumme stimmt nicht: $Destination" }
    Move-Item -LiteralPath $part -Destination $Destination -Force
}
$pdfRevision = '652653d64ddb4ccc88c56a3bf65946f44e6a6fbb'
$downloads = Join-Path $Runtime '.downloads'
$archive = Join-Path $downloads "pdf-$pdfRevision.zip"
Get-VerifiedFile "https://codeload.github.com/F100Pilot/PDF-to-GP5/zip/$pdfRevision" $archive 'FBAA6C96A88382F869A4BCC02E7069B1D04D6739E9483E7FC5C05627412B96D7'
$expanded = Join-Path $downloads "pdf-$pdfRevision"
Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
$source = Join-Path $expanded "PDF-to-GP5-$pdfRevision"
$pdfTarget = Join-Path $Runtime 'pdf-to-gp5'
New-Item -ItemType Directory -Force $pdfTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'app') -Destination $pdfTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $source 'LICENSE') -Destination $pdfTarget -Force
Copy-Item -LiteralPath (Join-Path $source 'THIRD_PARTY_NOTICES.md') -Destination $pdfTarget -Force

if (-not $SkipOmr) {
    Write-Host 'Installiere experimentelles Guitar Tab OMR (CPU). Modelllizenz: other; siehe Modellkarte.'
    & $venvPython -m pip install --disable-pip-version-check 'torch==2.5.1+cpu' 'torchvision==0.20.1+cpu' --index-url 'https://download.pytorch.org/whl/cpu'
    if ($LASTEXITCODE -ne 0) { throw 'PyTorch konnte nicht installiert werden.' }
    & $venvPython -m pip install --disable-pip-version-check 'timm==1.0.20'
    if ($LASTEXITCODE -ne 0) { throw 'Die OMR-Werkzeugpakete konnten nicht installiert werden.' }
    $spaceRevision = 'db9d40b3c5a686f875cbc0e4e48af63f4ac75187'
    $scripts = @{
        'guitar_omr_dataset_smoke.py' = '856F269BD545430046339B31A46CE0DC41FB0A8B1624E2287C91D9A76155EFEB'
        'guitar_omr_eval.py' = 'DA2BF2E41AA76ECB345F12CC3FC745263EDDCEE7D78337467FA2800B2B0E7D24'
        'guitar_omr_infer.py' = 'F3FB679BBEF3A634A02566B7CC7B36746237F7ECA71A4F78C6C91C935B234AED'
        'guitar_omr_train.py' = '2C268DA08BC3C65D448B1ED584967390679DE656EA055709EAE1A4ADF3059E18'
    }
    foreach ($entry in $scripts.GetEnumerator()) {
        Get-VerifiedFile "https://huggingface.co/spaces/kk9293/guitar-tab-omr/resolve/$spaceRevision/scripts/$($entry.Key)" (Join-Path $Runtime "omr/scripts/$($entry.Key)") $entry.Value
    }
    $modelRevision = 'cf0aa64313e981e3c4337e322df6540958a55e1d'
    Get-VerifiedFile "https://huggingface.co/kk9293/guitar-tab-omr/resolve/$modelRevision/best.pt" (Join-Path $Runtime 'omr/model/best.pt') '833A45752EB99CF525EC2744C20D93175540B487F162CAA38E554FC3C7FB0F7E'
    Get-VerifiedFile "https://huggingface.co/kk9293/guitar-tab-omr/resolve/$modelRevision/vocab.json" (Join-Path $Runtime 'omr/model/vocab.json') '1EF093ED50E391F02CFA95D4DA98600749C6822B839AD1CC586AF46922CFB1E3'
    @{
        model = 'https://huggingface.co/kk9293/guitar-tab-omr'
        modelRevision = $modelRevision
        scriptRevision = $spaceRevision
        license = 'other (see model card); no permissive redistribution license assumed'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Runtime 'omr/SOURCES.json') -Encoding UTF8
}
& $venvPython -c 'import rapidocr_onnxruntime, pdfplumber, guitarpro; print("PDF-to-GP5 bereit")'
if ($LASTEXITCODE -ne 0) { throw 'Werkzeugpruefung fehlgeschlagen.' }
if (-not $SkipOmr) {
    & $venvPython -c 'import torch, torchvision, timm; print("Guitar Tab OMR bereit (CPU)")'
    if ($LASTEXITCODE -ne 0) { throw 'OMR-Pruefung fehlgeschlagen.' }
}
Write-Host "Tab-Werkzeuge eingerichtet: $Runtime"
Write-Host 'App neu starten oder LOOPSTUDIO_TOOLS_RUNTIME auf diesen Ordner setzen.'
