# Mind Android v0.1.2（正式签名）

这是 Mind 的 Android 版本重做后的首个正式签名构建，基于 `main` 分支（含长期记忆、上下文压缩、连接器与用量功能）。适合日常安装使用，APK 使用独立的发布密钥签名，可直接覆盖安装后续 v0.1.2+ 版本。

## 下载

- 文件：`Mind_0.1.2_android-arm64-release.apk`
- 大小：11,948,662 字节（约 11.4 MB）
- SHA256：`cd1f1aee5aa5558de3d7ac9c8f6860121dec8db754a09a0d03e208f57df3283c`
- 架构：arm64-v8a（Android 7.0+ 的主流设备）
- 最低系统：Android 7.0（API 24）；targetSdk 36
- 包名：`com.mind.desktop`
- versionCode：1002
- 构建类型：release，已通过 `apksigner` 校验
- 签名证书：`CN=Mind, OU=Mind, O=Mind, C=CN`，SHA-256 `f324ac25163a66a3efdd7751afc4646dfa07cf43fc84ef18b40f501b01ba759b`

## 安装

1. 在 Android 手机上允许“安装未知来源应用”；
2. 如需从旧预览版升级：因为签名密钥不同，请先卸载旧的 `Mind` 预览版再安装本版（聊天与记忆数据也会被清除，必要时先导出备份）；
3. 首次启动：同意协议 → 填写 DeepSeek API Key → 开始聊天。API Key 之后会由 Android Keystore 加密保存，重启无需重填。

## 本次重做修复的问题

- **打包链路**：修复 Windows 上 `tauri-plugin-*` 构建脚本因 cargo registry 残留状态导致的 `os error 183 / 拒绝访问` 失败；提供一键构建脚本，自动清理残留、使用独立临时目录并在符号链接不可用时回退到 Gradle。
- **前端构建**：修复杀毒软件锁住 esbuild 临时文件导致的 `Access is denied` 构建中断。
- **启动图标**：Android 启动图标与自适应图标改为 Mind 品牌图标（之前是 Tauri 默认图标）。
- **凭据持久化**：API Key 与 GitHub Token 改为使用 Android Keystore（AES-256-GCM）加密保存在应用私有目录，重启应用后无需重新输入；备份与日志中不包含密钥。
- **系统返回键**：优先关闭抽屉/搜索、从设置或项目返回对话，在对话根页面退出应用。
- **应用加固**：关闭系统自动备份，FileProvider 仅暴露应用私有缓存/文件目录，不再暴露整个外部存储。
- **版本**：升级到 0.1.2（versionCode 1002）。由于签名密钥与旧的调试版 APK 不同，覆盖安装旧预览版前需要先卸载旧的预览版。

## 已实现

- 首次配置引导（模型 Key、上下文、搜索、记忆、用量）
- 移动布局：抽屉式历史侧栏、移动端设置导航、软键盘避让、edge-to-edge 安全区域
- 流式回复、Markdown、代码高亮、KaTeX、Mermaid、图表、图片
- 100k 默认上下文与自动压缩
- 联网搜索、长期记忆、用量与费用
- GitHub 只读连接（仓库、Issue、PR、搜索、文件）
- 本地 SQLite 历史、项目与记忆
- 数据备份：导出为可复制的 JSON；从文件选择器导入
- 浅色 / 深色 / 跟随系统主题
- 系统返回键处理与 Android Keystore 凭据持久化

## 重要限制

- **未在真实 Android 手机上完成运行时回归**：构建环境没有连接设备或模拟器。APK 已通过编译、签名校验和静态检查（包名、SDK、ABI、权限），但启动、软键盘、返回键、文件选择器与实际 API 请求仍建议在真机上确认。
- 不支持本地 MCP 插件（Android 无法启动 Node/uvx 子进程）；GitHub 只读连接保留。
- 备份导出仍需复制 JSON 内容后自行保存，暂不支持直接写入系统“下载”目录。
- 后台运行、通知、分享、语音、图片生成、自动同步尚未实现。
- 未上架应用商店。请离线备份发布密钥，否则无法为已安装用户提供升级包。

## 构建

详见仓库中的 [Android 构建说明](https://github.com/stone2010/Mind/blob/main/docs/BUILD_ANDROID.md)。简要步骤：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/android/build-android.ps1 -Mode release
```

需要 JDK 17、Android SDK Platform 36、Build Tools 36.0.0、NDK 27.0.12077973 和 Rust Android targets。
