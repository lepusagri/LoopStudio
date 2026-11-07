param(
    [ValidateSet('aarch64','x86_64')][string[]]$Targets=@('aarch64','x86_64'),
    [string]$SdkPath='',
    [string]$JavaPath=''
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
Push-Location $root
try {
    if(-not $SdkPath){$SdkPath=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{Join-Path $root '.installer/android/sdk'}}
    if(-not $JavaPath){$JavaPath=if($env:JAVA_HOME){$env:JAVA_HOME}else{(Get-ChildItem "$root/.installer/android/java" -Directory | Select-Object -First 1).FullName}}
    $env:JAVA_HOME=$JavaPath
    $env:ANDROID_HOME=[IO.Path]::GetFullPath($SdkPath)
    $env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
    $env:NDK_HOME=Join-Path $env:ANDROID_HOME 'ndk/28.2.13676358'
    $env:GRADLE_USER_HOME=Join-Path $root '.installer/android/gradle'
    $env:Path="$env:JAVA_HOME/bin;$env:Path"
    $env:CARGO_BUILD_JOBS='4'
    $env:CARGO_TARGET_DIR=Join-Path $root 'src-tauri/target'
    $env:ANDROID_USER_HOME=Join-Path $root '.installer/android/user'
    if(-not(Test-Path "$env:JAVA_HOME/bin/java.exe") -or -not(Test-Path "$env:NDK_HOME/source.properties")){throw 'Java 17+ and Android NDK 28.2.13676358 are required. See ANDROID.md.'}
    & npm.cmd run tauri android init -- --ci
    if($LASTEXITCODE -ne 0){throw 'Android project initialization failed'}
    # Use light status-bar icons over the application's dark background.
    foreach($flavor in @('values','values-night')){
        $theme=Join-Path $root "src-tauri/gen/android/app/src/main/res/$flavor/themes.xml"
        $text=[IO.File]::ReadAllText($theme).Replace('<!-- Customize your theme here. -->','<item name="android:windowLightStatusBar">false</item><item name="android:windowLightNavigationBar">false</item><item name="android:windowBackground">#111615</item><item name="android:statusBarColor">#111615</item>')
        [IO.File]::WriteAllText($theme,$text)
    }
    $mapping=@{aarch64=@{abi='arm64-v8a';flavor='Arm64';arch='arm64'};x86_64=@{abi='x86_64';flavor='X86_64';arch='x86_64'}}
    $output=Join-Path $root 'installers/android-preview'
    New-Item -ItemType Directory -Force $output | Out-Null
    foreach($target in $Targets){
        $log=Join-Path $root ".installer/android-preview-$target.log"
        & npm.cmd run tauri android build -- --debug --target $target --apk > $log 2>&1
        $cliExit=$LASTEXITCODE
        $info=$mapping[$target]
        $library=Join-Path $root "src-tauri/target/$target-linux-android/debug/libloopstudio_lib.so"
        if($cliExit -ne 0 -and ((Get-Content $log -Raw) -notmatch 'Creation symbolic link is not allowed')){Get-Content $log -Tail 30;throw "Android Rust build failed for $target"}
        if(-not(Test-Path $library)){throw "Android library missing for $target"}
        # The official CLI links the Rust library into Gradle's jniLibs directory.
        # A copy provides the same input without enabling Windows Developer Mode.
        $jni=Join-Path $root "src-tauri/gen/android/app/src/main/jniLibs/$($info.abi)"
        New-Item -ItemType Directory -Force $jni | Out-Null
        $destination=Join-Path $jni 'libloopstudio_lib.so'
        if(Test-Path $destination){Remove-Item -LiteralPath $destination}
        Copy-Item -LiteralPath $library -Destination $destination
        & "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe" --strip-debug $destination
        if($LASTEXITCODE -ne 0){throw 'Stripping debug symbols failed'}
        $apk=Join-Path $root "src-tauri/gen/android/app/build/outputs/apk/$($info.flavor.ToLowerInvariant())/debug/app-$($info.flavor.ToLowerInvariant())-debug.apk"
        # Removing this generated output forces a complete APK rewrite. Incremental
        # packaging can otherwise retain large obsolete native-library ZIP blocks.
        if(Test-Path -LiteralPath $apk){Remove-Item -LiteralPath $apk}
        $gradleLog=Join-Path $root ".installer/android-gradle-$target.log"
        & ./src-tauri/gen/android/gradlew.bat -p src-tauri/gen/android --no-daemon ":app:assemble$($info.flavor)Debug" -x "rustBuild$($info.flavor)Debug" "-PtargetList=$target" "-ParchList=$($info.arch)" "-PabiList=$($info.abi)" > $gradleLog 2>&1
        if($LASTEXITCODE -ne 0){Get-Content $gradleLog -Tail 35;throw 'Android APK packaging failed'}
        Copy-Item -LiteralPath $apk -Destination "$output/LoopStudio-0.8.1-Android-$target-Preview.apk"
        Write-Output "Built Android preview: $target"
    }
    Get-ChildItem $output -Filter *.apk | ForEach-Object { $hash=Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName; "$($hash.Hash.ToLowerInvariant())  $($_.Name)" } | Set-Content -Encoding utf8 "$output/SHA256SUMS.txt"
} finally { Pop-Location }
