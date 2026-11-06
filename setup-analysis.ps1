param([string]$Python = '')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$runtime = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../LoopStudio-runtime'))
if (-not (Test-Path (Join-Path $runtime 'Scripts/python.exe'))) {
    if (-not $Python) {
        $bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
        if (Test-Path $bundledPython) { $Python = $bundledPython }
        elseif (Get-Command python -ErrorAction SilentlyContinue) { $Python = (Get-Command python).Source }
        else { throw 'Python 3.12 (64 Bit) fehlt. Bitte installieren oder -Python mit dem Pfad zu python.exe angeben.' }
    }
    & $Python -c 'import sys; assert sys.version_info[:2] == (3,12), "Bitte Python 3.12 verwenden"'
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 wird benötigt.' }
    & $Python -m venv $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Analyseumgebung konnte nicht angelegt werden.' }
}
$enginePython = Join-Path $runtime 'Scripts/python.exe'
& $enginePython -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'PyTorch konnte nicht installiert werden.' }
# Basic Pitch's metadata mandates TensorFlow on Python 3.12, but its public ONNX backend
# works without TensorFlow. Install its complete inference dependencies explicitly.
& $enginePython -m pip install 'numpy==1.26.4' 'demucs==4.0.1' 'onnxruntime==1.31.1' 'librosa==0.11.0' 'resampy==0.4.2' mir_eval pretty_midi scikit-learn scipy soundfile imageio-ffmpeg
if ($LASTEXITCODE -ne 0) { throw 'Audiokomponenten konnten nicht installiert werden.' }
& $enginePython -m pip install basic-pitch==0.4.0 --no-deps
if ($LASTEXITCODE -ne 0) { throw 'Notenerkennung konnte nicht installiert werden.' }
$env:PYTHONUTF8 = '1'
& $enginePython (Join-Path $PSScriptRoot 'engine/prepare.py')
if ($LASTEXITCODE -ne 0) { throw 'Die Analysemodelle konnten nicht vorbereitet werden.' }
Write-Host 'Fertig. LoopStudio neu öffnen; die Analyse funktioniert jetzt lokal.'
