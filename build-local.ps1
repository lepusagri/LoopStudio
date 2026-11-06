param([string]$Runtime = (Join-Path $PSScriptRoot '../LoopStudio-runtime'))
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
& cargo build --manifest-path native-analysis/Cargo.toml --release --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
New-Item -ItemType Directory -Force $Runtime | Out-Null
Copy-Item -LiteralPath (Join-Path $target 'release/loopstudio-analysis.exe') -Destination (Join-Path $Runtime 'loopstudio-analysis.exe') -Force
npm.cmd run tauri build -- --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $target 'release/loopstudio.exe') -Destination (Join-Path $PSScriptRoot '../LoopStudio-0.7.3.exe') -Force
