# Android 构建与发布说明

本文说明如何在 Windows 上从源码构建 Mind 的 Android APK（debug 与正式签名 release），以及常见问题的处理。

## 1. 前置依赖

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| JDK | 17 | Gradle / AGP 需要；不要用 21+ |
| Android SDK Platform | 36 | `compileSdk = 36`、`targetSdk = 36` |
| Android Build Tools | 36.0.0 | 需要 `aapt2`、`apksigner`、`zipalign` |
| Android NDK | 27.0.12077973 | Rust 交叉编译链接器 |
| Rust | stable | 需要 `aarch64-linux-android`、`armv7-linux-androideabi`、`x86_64-linux-android` targets |
| Node.js | 20+ | 构建前端与调用 Tauri CLI |

安装 Rust Android targets：

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
```

SDK 组件可以用 `sdkmanager` 安装：

```bash
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.0.12077973"
```

## 2. 环境变量

```powershell
$env:JAVA_HOME="C:\path\to\jdk-17"
$env:ANDROID_HOME="C:\path\to\android-sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:NDK_HOME="$env:ANDROID_HOME\ndk\27.0.12077973"
```

`src-tauri/gen/android/local.properties` 也可以显式指定 SDK：

```properties
sdk.dir=C\:\\path\\to\\android-sdk
ndk.dir=C\:\\path\\to\\android-sdk\\ndk\\27.0.12077973
```

该文件与 `keystore.properties` 一样已被 `.gitignore` 忽略，不要提交。

## 3. 构建

仓库内提供一键构建脚本：

```powershell
# debug APK（arm64-v8a）
powershell -ExecutionPolicy Bypass -File scripts/android/build-android.ps1 -Mode debug

# 正式签名 release APK（arm64-v8a）
$env:MIND_ANDROID_KEYSTORE="C:\path\to\mind-release.keystore"
$env:MIND_ANDROID_KEYSTORE_PASSWORD="..."
$env:MIND_ANDROID_KEY_ALIAS="mind"
$env:MIND_ANDROID_KEY_PASSWORD="..."
powershell -ExecutionPolicy Bypass -File scripts/android/build-android.ps1 -Mode release
```

脚本等价于：

```bash
npx tauri android build --apk --debug --target aarch64   # debug
npx tauri android build --apk --target aarch64           # release
```

产物：

```text
src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

脚本会把 APK 复制到 `artifacts/` 并打印 SHA256，同时用 `apksigner` 校验签名。

### 签名

release 构建通过环境变量注入签名配置（`MIND_ANDROID_KEYSTORE`、`MIND_ANDROID_KEYSTORE_PASSWORD`、`MIND_ANDROID_KEY_ALIAS`、`MIND_ANDROID_KEY_PASSWORD`），
密钥库不会进入仓库。没有这些变量时，`assembleRelease` 仍能产出未签名 APK，便于验证编译。

生成发布密钥（只需一次，务必离线备份）：

```bash
keytool -genkeypair -v \
  -keystore mind-release.keystore -alias mind \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Mind, O=Mind, C=CN"
```

> ⚠️ 发布密钥丢失后无法再为已安装用户提供升级包。请把 `.keystore` 和密码保存在可信的离线位置。

### ABI

默认只构建 `arm64-v8a`（覆盖绝大多数 Android 7.0+ 真机）。需要覆盖 32 位老设备时可再构建 `armv7`：

```bash
npx tauri android build --apk --target armv7
```

## 4. 常见问题

### 4.1 Windows 未开启“开发者模式”时无法创建符号链接

Tauri CLI 在部分 Windows 环境会因为无法创建原生库符号链接而失败。处理方式：

1. 打开“设置 → 隐私和安全性 → 开发者选项 → 开发人员模式”，或
2. 先执行一次 `npx tauri android build ...`（即使最后在链接步骤失败，也会生成 `tauri.settings.gradle`、`app/tauri.properties`、`assets/tauri.conf.json`），
   然后把 `src-tauri/target/aarch64-linux-android/<debug|release>/libmind_lib.so` 复制到
   `src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/`，再运行：
   ```bash
   cd src-tauri/gen/android
   ./gradlew assembleArm64Debug -x rustBuildArm64Debug -x rustBuildUniversalDebug
   ```

`scripts/android/build-android.ps1` 已包含上述兜底逻辑。

### 4.2 `tauri-plugin-*` 构建脚本报 “os error 183 / 无法创建该文件”

这是 Windows 上 cargo registry 里上一次构建遗留的 `.tauri/tauri-api` 目录导致的。删除这些目录后重试：

```powershell
Get-ChildItem "$env:USERPROFILE\.cargo\registry\src\*\tauri-plugin-*\android\.tauri" -Directory |
  Remove-Item -Recurse -Force
```

构建脚本在每次构建前会自动清理。

### 4.3 前端构建报 esbuild 临时文件 “Access is denied”

杀毒软件会短暂锁住 `%TEMP%` 中的 esbuild 临时文件。把 `TMP`/`TEMP` 指向仓库外的独立目录后重试：

```powershell
$env:TMP="D:\build-tmp"; $env:TEMP="D:\build-tmp"
npm run build
```

构建脚本同样会设置专用的临时目录。

### 4.4 Gradle 下载慢

`gradle-wrapper.properties` 使用官方源。在国内可以把 `distributionUrl` 换成镜像（本地改动即可，不建议提交）：

```properties
distributionUrl=https\://mirrors.cloud.tencent.com/gradle/gradle-9.6.1-bin.zip
```

### 4.5 受限/沙箱环境下出现 “拒绝访问 / Access is denied”

部分企业安全软件或受限 Windows 沙箱只允许新编译出的未签名辅助程序写入工作区，这会让 `tauri-plugin-*` 的构建脚本（往 cargo registry 复制 `tauri-api`）以及 Gradle、JDK 写用户目录缓存时失败。把缓存和临时目录都指向工作区即可：

```powershell
$env:CARGO_HOME = "D:\build\cargo-home"           # 先复制 %USERPROFILE%\.cargo 过来
$env:GRADLE_USER_HOME = "D:\build\gradle-home"    # 先复制 %USERPROFILE%\.gradle 过来
$env:ANDROID_USER_HOME = "D:\build\android-home"
$env:TMP = "D:\build\tmp"; $env:TEMP = "D:\build\tmp"
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=D:\build\tmp"
```

复制缓存时用 `robocopy %USERPROFILE%\.cargo D:\build\cargo-home /E` 可以保留目录结构。

### 4.6 构建成功后 APK 在哪里

```text
src-tauri/gen/android/app/build/outputs/apk/<abi>/<debug|release>/app-<abi>-<debug|release>.apk
```

`scripts/android/build-android.ps1` 会把它复制到 `artifacts/` 并校验签名。

## 5. 静态验证

```bash
# 签名校验
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --print-certs artifacts/Mind_0.1.2_android-arm64-release.apk

# 包信息（包名、版本、SDK、权限）
"$ANDROID_HOME/build-tools/36.0.0/aapt2.exe" dump badging artifacts/Mind_0.1.2_android-arm64-release.apk
```

## 6. 已知限制

- 没有在真机上完成运行时回归（构建环境无设备）；发布前建议在 Android 7/12/14/15 真机上验证启动、软键盘、返回键、文件选择器与实际 API 请求。
- 本地 MCP 插件（Node/uvx 子进程）在 Android 上不可用；GitHub 只读连接可用。
- 备份导出在 Android 上仍是复制 JSON 文本，暂不支持直接写入系统“下载”目录。
