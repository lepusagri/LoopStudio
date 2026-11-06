param(
    [switch]$CpuOnly,
    [string]$Runtime = (Join-Path $PSScriptRoot '../LoopStudio-runtime'),
    [string]$AutoTabHome = '',
    [string]$Worker = ''
)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
if ($AutoTabHome) { $AutoTabHome = [IO.Path]::GetFullPath($AutoTabHome) }
if ($Worker) { $Worker = [IO.Path]::GetFullPath($Worker) }
$Runtime = [IO.Path]::GetFullPath($Runtime)
New-Item -ItemType Directory -Force $Runtime | Out-Null
Push-Location $Runtime
try {
New-Item -ItemType Directory -Force runtime, models, .runtime-downloads | Out-Null
if ($AutoTabHome) {
    foreach ($folder in @('runtime','models')) {
        $source = Join-Path $AutoTabHome $folder
        if (Test-Path $source) { Copy-Item "$source/*" $folder -Recurse -Force }
    }
}
function Get-File($Url, $Destination, $Sha256 = '') {
    $part = "$Destination.part"
    & curl.exe -fL --retry 3 --connect-timeout 20 $Url -o $part
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    if ($Sha256 -and (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash -ne $Sha256) {
        throw "SHA256 mismatch: $Destination"
    }
    Move-Item -LiteralPath $part -Destination $Destination -Force
}

if (-not (Test-Path runtime/ffmpeg.exe)) {
    if (-not (Get-ChildItem .runtime-downloads/ffmpeg/*/bin/ffmpeg.exe -ErrorAction SilentlyContinue)) {
        Get-File 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip' '.runtime-downloads/ffmpeg.zip'
        Expand-Archive -LiteralPath .runtime-downloads/ffmpeg.zip -DestinationPath .runtime-downloads/ffmpeg -Force
    }
    Copy-Item (Get-ChildItem .runtime-downloads/ffmpeg/*/bin/ffmpeg.exe | Select-Object -First 1).FullName runtime/ffmpeg.exe
}

if (-not (Test-Path runtime/onnxruntime.dll)) {
    Get-File 'https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-win-x64-1.23.2.zip' '.runtime-downloads/onnxruntime.zip' '0B38DF9AF21834E41E73D602D90DB5CB06DBD1CA618948B8F1D66D607AC9F3CD'
    Expand-Archive -LiteralPath .runtime-downloads/onnxruntime.zip -DestinationPath .runtime-downloads/onnxruntime -Force
    Get-ChildItem .runtime-downloads/onnxruntime -Recurse -Filter '*.dll' | Copy-Item -Destination runtime
}

if (-not $CpuOnly) {
    $target = 'runtime/openvino-2026.4.1'
    $marker = "$target/package-version.txt"
    $libraries = @('openvino.dll', 'openvino_c.dll', 'openvino_intel_gpu_plugin.dll', 'openvino_intel_cpu_plugin.dll', 'openvino_onnx_frontend.dll', 'openvino_ir_frontend.dll', 'tbb12.dll', 'tbbbind_2_5.dll', 'tbbmalloc.dll', 'tbbmalloc_proxy.dll')
    $missing = @($libraries | Where-Object { -not (Test-Path "$target/$_") })
    if ($missing.Count -gt 0 -or -not (Test-Path $marker) -or (Get-Content $marker -Raw).Trim() -ne '2026.4.1-22982') {
        $archive = '.runtime-downloads/openvino-2026.4.1.zip'
        $hash = '45AD6947F404049CB54807638AD35A67C66C0C90D1E89EE6CC45F92021CB6C45'
        if (-not (Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $hash) {
            Get-File 'https://files.pythonhosted.org/packages/71/e1/0be67369907ced8a68129e5edfe89a6bedbb4e78fc7aa93ff49157905edb/openvino-2026.4.1-22982-cp310-cp310-win_amd64.whl' $archive $hash
        }
        # The official archive is a wheel container. Only native runtime DLLs
        # are extracted for the application; no Python is installed or executed.
        Expand-Archive -LiteralPath $archive -DestinationPath .runtime-downloads/openvino-2026.4.1 -Force
        New-Item -ItemType Directory -Force $target | Out-Null
        foreach ($library in $libraries) {
            Copy-Item -LiteralPath ".runtime-downloads/openvino-2026.4.1/openvino/libs/$library" -Destination $target -Force
        }
        '2026.4.1-22982' | Set-Content $marker -Encoding ASCII
    }
}

$model = 'models/htdemucs_6s.onnx'
$modelHash = '48F8E84945579F8AB340E083339E9221E03785DBE733A52C388200B6D3CA779A'
if (-not (Test-Path $model) -or (Get-FileHash $model -Algorithm SHA256).Hash -ne $modelHash) {
    Get-File 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/49df9b6989cf2150840ea65b0bef77a2e471b678/htdemucs_6s.onnx' $model $modelHash
}


New-Item -ItemType Directory -Force 'runtime/licenses' | Out-Null
Get-ChildItem '.runtime-downloads/onnxruntime' -Recurse -File -Include LICENSE,ThirdPartyNotices.txt -ErrorAction SilentlyContinue | Copy-Item -Destination 'runtime/licenses' -Force
if (-not $Worker) {
    $target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $project 'native-analysis/target' }
    $Worker = Join-Path $target 'release/loopstudio-analysis.exe'
}
if (Test-Path $Worker) { Copy-Item -LiteralPath $Worker -Destination 'loopstudio-analysis.exe' -Force }
if (-not (Test-Path 'loopstudio-analysis.exe')) { Write-Warning 'Rust-Analyseprozess noch nicht gebaut: build-local.ps1 ausführen.' }
Write-Host "Native Modelle und Bibliotheken bereit: $Runtime"
} finally { Pop-Location }
