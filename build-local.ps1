param(
    [string]$Runtime = (Join-Path $PSScriptRoot '../LoopStudio-runtime'),
    [string]$ToolsRuntime = (Join-Path $PSScriptRoot 'LoopStudio-tools-runtime'),
    [string]$Output = '',
    # Kept for existing callers; PDF-to-GP5 is always enabled.
    [switch]$PythonTabTools
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$localToolchain = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../work/toolchain'))
if (Test-Path (Join-Path $localToolchain 'cargo/bin/cargo.exe')) {
    $env:CARGO_HOME = Join-Path $localToolchain 'cargo'
    $env:RUSTUP_HOME = Join-Path $localToolchain 'rustup'
    $env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
}
$target = if ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $PSScriptRoot 'src-tauri/target' }
$env:CARGO_TARGET_DIR = $target
$version = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Output) { $Output = Join-Path $target "LoopStudio-$version" }
$toolsPython = @('python/python.exe','Scripts/python.exe') | ForEach-Object { Join-Path $ToolsRuntime $_ } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $toolsPython -or -not (Test-Path -LiteralPath (Join-Path $ToolsRuntime 'pdf-to-gp5/app/converter.py'))) {
    throw "PDF-to-GP5-Laufzeit fehlt. Zuerst ./setup-tab-tools-python.ps1 -Runtime '$ToolsRuntime' ausfuehren."
}
# Exercise the same converter that is copied into the finished app directory.
& $toolsPython (Join-Path $PSScriptRoot 'tooling/tab_worker.py') --engine pdf --source (Join-Path $PSScriptRoot 'native-tab-tools/tests/fixtures/tab.pdf') --runtime $ToolsRuntime --output (Join-Path $target 'pdf-to-gp5-build-check') --bpm 120
if ($LASTEXITCODE -ne 0) { throw 'PDF-to-GP5-Laufzeitpruefung fehlgeschlagen. Build abgebrochen.' }
New-Item -ItemType Directory -Force $Output, $ToolsRuntime | Out-Null
& cargo build --manifest-path native-analysis/Cargo.toml --release --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
New-Item -ItemType Directory -Force $Runtime | Out-Null
Copy-Item -LiteralPath (Join-Path $target 'release/loopstudio-analysis.exe') -Destination (Join-Path $Runtime 'loopstudio-analysis.exe') -Force
& cargo build --manifest-path native-tab-tools/Cargo.toml --release --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $target 'release/loopstudio-tab-tools.exe') -Destination (Join-Path $ToolsRuntime 'loopstudio-tab-tools.exe') -Force
$tauriArguments = @('run','tauri','build','--','--no-bundle','--features','python-tab-tools')
$tauriArguments += @('--','--locked')
& npm.cmd @tauriArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $target 'release/loopstudio.exe') -Destination (Join-Path $Output "LoopStudio-$version.exe") -Force
foreach ($entry in @(@{Source=$Runtime;Name='LoopStudio-runtime'},@{Source=$ToolsRuntime;Name='LoopStudio-tools-runtime'})) {
    $destination = [IO.Path]::GetFullPath((Join-Path $Output $entry.Name))
    if ((Test-Path -LiteralPath $entry.Source) -and [IO.Path]::GetFullPath($entry.Source) -ne $destination) {
        New-Item -ItemType Directory -Force $destination | Out-Null
        Get-ChildItem -LiteralPath $entry.Source -Force | Copy-Item -Destination $destination -Recurse -Force
    }
}
Write-Host "Windows-App erstellt: $Output"
