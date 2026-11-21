# Mind Android 预览版（基于 v0.1.1）

> ⚠️ 此预览版已被 [Mind Android v0.1.2](release-notes-v0.1.2-android.md)（正式签名、Keystore 凭据持久化、系统返回键、品牌图标）取代，请优先下载新版本。

这是 Mind 的 Android 预览构建，用于验证移动端聊天、历史记录和 GitHub 连接。**不是正式版**，请勿用于重要数据或生产用途。

## 下载

- `Mind_0.1.1_android-arm64-debug.apk`
- 架构：arm64-v8a（绝大多数近年的 Android 手机）
- 最低系统：Android 7.0（API 24）
- 构建类型：debug，使用 Android 调试签名；未使用正式发布密钥签名
- 大小：30,358,486 字节（约 29.0 MB）
- SHA256：`9ce0ba2851778fc7d2a98aaca18f9633f5168c8978dd0d958a86c4d837a83f4e`

## 已实现

- 首次配置引导（模型 Key、上下文、搜索、记忆、用量）
- 响应式聊天界面：抽屉式历史侧栏、移动端设置页、软键盘避让
- 流式回复、Markdown、代码高亮、KaTeX、Mermaid、图表、图片
- 100k 默认上下文与自动压缩
- 联网搜索、长期记忆、用量与费用
- GitHub 只读连接（仓库、Issue、PR、搜索、文件）
- 本地 SQLite 历史、项目与记忆
- 数据备份：导出为可复制的 JSON；从文件选择器导入
- 浅色 / 深色 / 跟随系统主题

## 重要限制

- **API Key 与 GitHub Token 只保存在本次运行的内存中**：Android 预览版尚未接入 Android Keystore，重启应用后需要重新输入；不会以明文写入数据库或磁盘。
- **不支持本地 MCP 插件**：Android 无法像桌面版那样启动 Node/uvx 子进程；设置中的本地插件区域已隐藏，GitHub 连接保留。
- **未在真实 Android 手机上验证**：构建环境没有连接设备或模拟器；APK 已通过编译与静态检查，但实际启动、软键盘、文件选择器和 API 请求尚未在手机上运行确认。
- 备份导出不能直接写入系统“下载”目录；需复制 JSON 内容并自行保存为文件。
- 后台运行、通知、分享、语音、图片生成、自动同步尚未实现。
- 使用 debug 签名，不适合上架应用商店；正式分发前需要生成并妥善保管发布密钥。

## 构建

需要 JDK 17、Android SDK Platform 36、Build Tools 36、NDK 27 和 Rust Android targets。

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973
npx tauri android build --apk --debug --target aarch64
```

产物位于：

```text
src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
```

Windows 未开启开发者模式时，Tauri CLI 会在创建原生库符号链接时失败。先开启开发者模式；如果无法开启，需要先运行一次 `npx tauri android init --ci` 和 `npx tauri android build --apk --debug --target aarch64`，让 CLI 生成 `tauri.settings.gradle`、`tauri.build.gradle.kts` 和 `assets/tauri.conf.json`（即使最后在符号链接处失败），然后手动把 `src-tauri/target/aarch64-linux-android/debug/libmind_lib.so` 复制到 `src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/`，再运行：

```bash
cd src-tauri/gen/android
./gradlew assembleArm64Debug -x rustBuildArm64Debug -x rustBuildUniversalDebug
```
