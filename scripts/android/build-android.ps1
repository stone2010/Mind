#requires -Version 5.1
<#
.SYNOPSIS
  Build the Mind Android APK (debug or signed release) from the repository root.

.DESCRIPTION
  Wraps `tauri android build` and works around the Windows problems that used to
  break Android packaging:
    * stale `.tauri/tauri-api` folders left in the cargo registry by a previous
      build (build script fails with "os error 183");
    * antivirus locking esbuild temp files in %TEMP% (front end build fails with
      "Access is denied");
    * Windows Developer Mode being off, so Tauri CLI cannot create the native
      library symlink. In that case the script copies libmind_lib.so into jniLibs
      and runs Gradle with the Rust tasks skipped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/android/build-android.ps1 -Mode debug

.EXAMPLE
  $env:MIND_ANDROID_KEYSTORE="D:\keys\mind-release.keystore"
  $env:MIND_ANDROID_KEYSTORE_PASSWORD="..."
  $env:MIND_ANDROID_KEY_ALIAS="mind"
  $env:MIND_ANDROID_KEY_PASSWORD="..."
  powershell -ExecutionPolicy Bypass -File scripts/android/build-android.ps1 -Mode release
#>
param(
  [ValidateSet("debug", "release")]
  [string]$Mode = "release",
  [ValidateSet("arm64", "armv7", "x86", "x86_64")]
  [string]$Abi = "arm64",
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$AndroidHome = $env:ANDROID_HOME,
  [string]$NdkHome = $env:NDK_HOME
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

function Fail($message) {
  Write-Host "ERROR: $message" -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------- environment
if (-not $JavaHome) { Fail "JAVA_HOME is not set. Install JDK 17 and point JAVA_HOME at it." }
if (-not (Test-Path (Join-Path $JavaHome "bin\java.exe"))) { Fail "JAVA_HOME does not look like a JDK: $JavaHome" }
if (-not $AndroidHome) { Fail "ANDROID_HOME is not set. Install the Android SDK (platform 36, build tools 36, NDK 27)." }
if (-not (Test-Path (Join-Path $AndroidHome "platforms\android-36\android.jar"))) { Fail "Android SDK platform 36 not found under $AndroidHome" }
$ndkRoot = if ($NdkHome) { $NdkHome } else { Join-Path $AndroidHome "ndk\27.0.12077973" }
if (-not (Test-Path (Join-Path $ndkRoot "source.properties"))) { Fail "Android NDK 27.0.12077973 not found at $ndkRoot" }

$abiInfo = @{
  arm64  = @{ Rust = "aarch64-linux-android";      Dir = "arm64-v8a";   Flavor = "Arm64" }
  armv7  = @{ Rust = "armv7-linux-androideabi";    Dir = "armeabi-v7a"; Flavor = "Arm" }
  x86    = @{ Rust = "i686-linux-android";         Dir = "x86";         Flavor = "X86" }
  x86_64 = @{ Rust = "x86_64-linux-android";       Dir = "x86_64";      Flavor = "X86_64" }
}[$Abi]

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$env:NDK_HOME = $ndkRoot
$env:PATH = "$JavaHome\bin;$AndroidHome\platform-tools;$env:PATH"

# Dedicated temp directory: antivirus sometimes locks esbuild temp files in %TEMP%.
$buildTemp = Join-Path $repoRoot ".dev\android-tmp"
New-Item -ItemType Directory -Force -Path $buildTemp | Out-Null
$env:TMP = $buildTemp
$env:TEMP = $buildTemp
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$buildTemp"

Write-Host "JDK:     $JavaHome"
Write-Host "SDK:     $AndroidHome"
Write-Host "NDK:     $ndkRoot"
Write-Host "Mode:    $Mode"
Write-Host "ABI:     $Abi ($($abiInfo.Dir))"

# --------------------------------------------------- stale tauri plugin state
# Windows leaves Cargo registry plugin android/.tauri folders behind; a later
# build then fails with "failed to create directory ... os error 183".
$cargoRegistries = @()
if ($env:CARGO_HOME) { $cargoRegistries += (Join-Path $env:CARGO_HOME "registry\src") } else {
  $cargoRegistries += (Join-Path $env:USERPROFILE ".cargo\registry\src")
}
foreach ($registry in $cargoRegistries) {
  if (Test-Path $registry) {
    Get-ChildItem -Path $registry -Directory |
      ForEach-Object {
        Get-ChildItem -Path $_.FullName -Directory -Filter "tauri-plugin-*" -ErrorAction SilentlyContinue |
          ForEach-Object {
            $stale = Join-Path $_.FullName "android\.tauri"
            if (Test-Path $stale) {
              Write-Host "Cleaning stale state: $stale"
              Remove-Item -Recurse -Force $stale -ErrorAction SilentlyContinue
            }
          }
      }
  }
}

# --------------------------------------------------------------- release check
$signing = $false
if ($Mode -eq "release") {
  $signing = $env:MIND_ANDROID_KEYSTORE -and $env:MIND_ANDROID_KEYSTORE_PASSWORD -and
             $env:MIND_ANDROID_KEY_ALIAS -and $env:MIND_ANDROID_KEY_PASSWORD
  if ($signing) {
    if (-not (Test-Path $env:MIND_ANDROID_KEYSTORE)) { Fail "Keystore not found: $env:MIND_ANDROID_KEYSTORE" }
    Write-Host "Release signing: $($env:MIND_ANDROID_KEYSTORE) (alias $($env:MIND_ANDROID_KEY_ALIAS))"
  } else {
    Write-Host "WARNING: signing variables are not set; the release APK will be unsigned." -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------- build
$tauriArgs = @("tauri", "android", "build", "--apk", "--target", $Abi)
if ($Mode -eq "debug") { $tauriArgs += "--debug" }

$androidDir = Join-Path $repoRoot "src-tauri\gen\android"
$modeName = if ($Mode -eq "debug") { "Debug" } else { "Release" }

Write-Host "`n==> npx $($tauriArgs -join ' ')" -ForegroundColor Cyan
& npx @tauriArgs
$tauriExit = $LASTEXITCODE

if ($tauriExit -ne 0) {
  Write-Host "`nTauri CLI build failed (exit $tauriExit); trying the Gradle fallback." -ForegroundColor Yellow

  $nativeLib = Join-Path $repoRoot "src-tauri\target\$($abiInfo.Rust)\$Mode\libmind_lib.so"
  if (-not (Test-Path $nativeLib)) {
    Fail "Rust library not found at $nativeLib, cannot fall back to Gradle. Fix the Rust build first."
  }

  $jniDir = Join-Path $androidDir "app\src\main\jniLibs\$($abiInfo.Dir)"
  New-Item -ItemType Directory -Force -Path $jniDir | Out-Null
  Copy-Item -Force $nativeLib (Join-Path $jniDir "libmind_lib.so")
  Write-Host "Copied libmind_lib.so into jniLibs\$($abiInfo.Dir)"

  # The mobile runtime reads app/src/main/assets/tauri.conf.json.
  $assetsDir = Join-Path $androidDir "app\src\main\assets"
  New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
  Copy-Item -Force (Join-Path $repoRoot "src-tauri\tauri.conf.json") (Join-Path $assetsDir "tauri.conf.json")

  $gradleTask = "assemble$($abiInfo.Flavor)$modeName"
  $skipRust = @("-x", "rustBuild$($abiInfo.Flavor)$modeName", "-x", "rustBuildUniversal$modeName")
  Push-Location $androidDir
  try {
    Write-Host "`n==> gradlew $gradleTask $($skipRust -join ' ')" -ForegroundColor Cyan
    & .\gradlew.bat $gradleTask @skipRust
    if ($LASTEXITCODE -ne 0) { Fail "Gradle build failed." }
  } finally {
    Pop-Location
  }
}

# -------------------------------------------------------------------- package
$outputApk = Join-Path $androidDir "app\build\outputs\apk\$Abi\$Mode\app-$Abi-$Mode.apk"
$apk = Get-Item -Path $outputApk -ErrorAction SilentlyContinue
if (-not $apk) {
  $candidate = Get-ChildItem -Path (Join-Path $androidDir "app\build\outputs\apk") -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match [regex]::Escape("\$Abi\$Mode\") } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($candidate) { $apk = $candidate } else { Fail "APK not found under app/build/outputs/apk." }
}

$artifacts = Join-Path $repoRoot "artifacts"
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$version = (Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version
$targetName = "Mind_${version}_android-$Abi-$Mode.apk"
$target = Join-Path $artifacts $targetName
Copy-Item -Force $apk.FullName $target

$hash = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLower()
Write-Host "`nAPK:    $target"
Write-Host "Size:   $((Get-Item $target).Length) bytes"
Write-Host "SHA256: $hash"

$apksigner = Join-Path $AndroidHome "build-tools\36.0.0\apksigner.bat"
if ((Test-Path $apksigner) -and $signing) {
  Write-Host "`n==> apksigner verify" -ForegroundColor Cyan
  & $apksigner verify --print-certs $target | Select-Object -First 6
  if ($LASTEXITCODE -ne 0) { Fail "APK signature verification failed." }
}
