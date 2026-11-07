param(
    [string]$Runtime = (Join-Path $PSScriptRoot 'LoopStudio-tools-runtime'),
    [string]$Python = '',
    [switch]$SkipOmr,
    [string]$OmrOnnx = '',
    [string]$Worker = ''
)
$ErrorActionPreference = 'Stop'
$Runtime = [IO.Path]::GetFullPath($Runtime)
$downloads = Join-Path $PSScriptRoot '.runtime-downloads/tab-tools'
New-Item -ItemType Directory -Force $Runtime, $downloads, (Join-Path $Runtime 'runtime'), (Join-Path $Runtime 'models/ocr'), (Join-Path $Runtime 'runtime/licenses') | Out-Null
function Get-VerifiedFile([string]$Url, [string]$Destination, [string]$Sha256) {
    if ((Test-Path -LiteralPath $Destination) -and (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256) { return }
    New-Item -ItemType Directory -Force (Split-Path $Destination -Parent) | Out-Null
    $part = "$Destination.part"
    & curl.exe -fL --retry 3 --connect-timeout 20 $Url -o $part
    if ($LASTEXITCODE -ne 0) { throw "Download fehlgeschlagen: $Url" }
    if ((Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash -ne $Sha256) { throw "Pruefsumme stimmt nicht: $Destination" }
    Move-Item -LiteralPath $part -Destination $Destination -Force
}
$pdfium = Join-Path $downloads 'pdfium.tgz'
Get-VerifiedFile 'https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8138/pdfium-win-x64.tgz' $pdfium '8D48973E3EB472DDA0F5F2435E595AC043F9F2219DD71883392F549445AFA8A5'
$pdfiumFiles = Join-Path $downloads 'pdfium'
New-Item -ItemType Directory -Force $pdfiumFiles | Out-Null
& tar.exe -xzf $pdfium -C $pdfiumFiles
if ($LASTEXITCODE -ne 0) { throw 'PDFium konnte nicht entpackt werden.' }
Copy-Item -LiteralPath (Join-Path $pdfiumFiles 'bin/pdfium.dll') -Destination (Join-Path $Runtime 'runtime') -Force
Copy-Item -LiteralPath (Join-Path $pdfiumFiles 'licenses') -Destination (Join-Path $Runtime 'runtime/licenses/pdfium') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $pdfiumFiles 'LICENSE') -Destination (Join-Path $Runtime 'runtime/licenses/pdfium-build.txt') -Force
$ortArchive = Join-Path $downloads 'onnxruntime.zip'
Get-VerifiedFile 'https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-win-x64-1.23.2.zip' $ortArchive '0B38DF9AF21834E41E73D602D90DB5CB06DBD1CA618948B8F1D66D607AC9F3CD'
Expand-Archive -LiteralPath $ortArchive -DestinationPath (Join-Path $downloads 'onnxruntime') -Force
Get-ChildItem (Join-Path $downloads 'onnxruntime') -Recurse -Filter '*.dll' | Copy-Item -Destination (Join-Path $Runtime 'runtime') -Force
Get-ChildItem (Join-Path $downloads 'onnxruntime') -Recurse -File -Include LICENSE,ThirdPartyNotices.txt | Copy-Item -Destination (Join-Path $Runtime 'runtime/licenses') -Force
$ocr = Join-Path $downloads 'rapidocr.zip'
Get-VerifiedFile 'https://files.pythonhosted.org/packages/ba/12/1e5497183bdbe782dbb91bad1d0d2297dba4d2831b2652657f7517bfc6df/rapidocr_onnxruntime-1.4.4-py3-none-any.whl' $ocr '971D7D5F223A7A808662229DF1EF69893809D8457D834E6373D3854BC1782CBF'
Expand-Archive -LiteralPath $ocr -DestinationPath (Join-Path $downloads 'rapidocr') -Force
Copy-Item -LiteralPath (Join-Path $downloads 'rapidocr/rapidocr_onnxruntime/models/ch_PP-OCRv4_rec_infer.onnx') -Destination (Join-Path $Runtime 'models/ocr/recognizer.onnx') -Force
# The wheel supplies model weights only; no Python package is installed.
Get-ChildItem (Join-Path $downloads 'rapidocr') -Recurse -File -Filter '*LICENSE*' | Copy-Item -Destination (Join-Path $Runtime 'runtime/licenses') -Force
Get-VerifiedFile 'https://www.apache.org/licenses/LICENSE-2.0.txt' (Join-Path $Runtime 'runtime/licenses/PP-OCRv4-Apache-2.0.txt') 'CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30'
if (-not $SkipOmr) {
    $omrTarget = Join-Path $Runtime 'models/omr'
    if ($OmrOnnx) {
        New-Item -ItemType Directory -Force $omrTarget | Out-Null
        foreach ($name in @('encoder.onnx', 'decoder.onnx', 'manifest.json')) { Copy-Item -LiteralPath (Join-Path $OmrOnnx $name) -Destination $omrTarget -Force }
    } elseif (-not (Test-Path (Join-Path $omrTarget 'manifest.json'))) {
        if (-not $Python) { throw 'OMR einmal konvertieren: -Python <Python mit torch, torchvision, timm, onnx, onnxruntime> oder -OmrOnnx <Modellordner>. -SkipOmr richtet nur PDF/OCR ein.' }
        $scripts = Join-Path $downloads 'omr-scripts'
        $revision = 'db9d40b3c5a686f875cbc0e4e48af63f4ac75187'
        $hashes = @{
            'guitar_omr_dataset_smoke.py' = '856F269BD545430046339B31A46CE0DC41FB0A8B1624E2287C91D9A76155EFEB'
            'guitar_omr_eval.py' = 'DA2BF2E41AA76ECB345F12CC3FC745263EDDCEE7D78337467FA2800B2B0E7D24'
            'guitar_omr_train.py' = '2C268DA08BC3C65D448B1ED584967390679DE656EA055709EAE1A4ADF3059E18'
        }
        foreach ($entry in $hashes.GetEnumerator()) { Get-VerifiedFile "https://huggingface.co/spaces/kk9293/guitar-tab-omr/resolve/$revision/scripts/$($entry.Key)" (Join-Path $scripts $entry.Key) $entry.Value }
        $checkpoint = Join-Path $downloads 'omr-best.pt'
        Get-VerifiedFile 'https://huggingface.co/kk9293/guitar-tab-omr/resolve/cf0aa64313e981e3c4337e322df6540958a55e1d/best.pt' $checkpoint '833A45752EB99CF525EC2744C20D93175540B487F162CAA38E554FC3C7FB0F7E'
        & $Python (Join-Path $PSScriptRoot 'tooling/export_tab_omr.py') --checkpoint $checkpoint --scripts $scripts --output $omrTarget
        if ($LASTEXITCODE -ne 0) { throw 'OMR-Export oder Modellvergleich fehlgeschlagen.' }
    }
    $manifest = Get-Content (Join-Path $omrTarget 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.formatVersion -ne 1) { throw 'Nicht unterstuetztes OMR-Modellformat.' }
    foreach ($name in @('encoder', 'decoder')) {
        $hash = $manifest."$($name)Sha256"
        if ((Get-FileHash (Join-Path $omrTarget "$name.onnx") -Algorithm SHA256).Hash -ne $hash) { throw "OMR-Pruefsumme falsch: $name" }
    }
}
if (-not $Worker) { $Worker = Join-Path $PSScriptRoot 'src-tauri/target/release/loopstudio-tab-tools.exe' }
if (Test-Path -LiteralPath $Worker) { Copy-Item -LiteralPath $Worker -Destination (Join-Path $Runtime 'loopstudio-tab-tools.exe') -Force }
if (-not (Test-Path (Join-Path $Runtime 'loopstudio-tab-tools.exe'))) { Write-Warning 'Rust-Tab-Werkzeuge noch nicht gebaut: build-local.ps1 ausfuehren.' }
Write-Host "Native Tab-Werkzeuge bereit: $Runtime. Im Betrieb wird kein Python verwendet."
