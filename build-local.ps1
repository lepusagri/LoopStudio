$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$localToolchain = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../work/toolchain'))
if (Test-Path (Join-Path $localToolchain 'cargo/bin/cargo.exe')) {
    $env:CARGO_HOME = Join-Path $localToolchain 'cargo'
    $env:RUSTUP_HOME = Join-Path $localToolchain 'rustup'
    $env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
}
npm.cmd run tauri build -- --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'src-tauri/target/release/loopstudio.exe') -Destination (Join-Path $PSScriptRoot '../LoopStudio-0.2.exe') -Force
