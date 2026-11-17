# Mind v0.1.0

Mind 的首个 Windows 预览版：本地优先、自带 API Key、上下文和费用可控的桌面 AI 客户端。

## 下载

- `Mind_0.1.0_x64-setup.exe`（Windows 10 / 11，x64）
- SHA256：`dc6906683b9c586f4260d17d50cdad452cb25da9d46fce86cb90b7de4269d359`

安装包未进行代码签名，Windows SmartScreen 可能显示“未知发布者”；请确认下载来源。

## 亮点

- **首次配置引导**：连接 DeepSeek → 选择上下文与费用偏好 → 选择本地插件
- **聊天**：流式输出、Markdown、代码高亮、KaTeX 公式、附件、图片、停止/重新生成/编辑重发
- **上下文**：默认 100k，支持 4k / 8k / 16k / 完整历史与自定义 0–128k；超过预算自动压缩为持久化摘要
- **联网搜索**：DeepSeek 服务端搜索与来源卡片，多轮工具历史
- **长期记忆**：手动添加或回复后自动提取，可按需注入
- **连接器**：本地 stdio MCP 插件中心、Node/uv 环境检测、逐次授权
- **GitHub**：使用 Personal Access Token 只读访问仓库、Issue、PR、搜索和文件；Token 仅存 Windows 凭据管理器
- **用量看板**：真实 token 用量、峰谷分类、自填单价估算、可关闭
- **可视化**：Mermaid 流程图、柱状/折线/饼图、图片放大
- **本地数据**：SQLite 保存聊天/项目/记忆/用量；API Key 与 GitHub Token 保存在 Windows Credential Manager

## 首次使用

1. 运行安装包并启动 Mind；
2. 按引导填写 DeepSeek API Key；
3. 选择上下文长度和需要开启的功能；
4. 可选：在“设置 → 连接器”中添加本地 MCP 插件或连接 GitHub；
5. 开始聊天。

## 验证状态与限制

- 本地 Mock 已验证：流式聊天、搜索、自动记忆、MCP 工具授权、GitHub 五类只读工具、上下文压缩、用量看板、Mermaid/图表渲染和首次配置流程。
- **未使用真实 DeepSeek Key 发起收费调用**；真实生成、搜索和费用未在当前环境核对。
- **未使用真实 GitHub Token 连接 GitHub.com**；仅通过 GitHub REST Mock 验证 API 路径和工具逻辑。
- 未实现深度研究、语音、图像生成、Canvas、GPTs、定时任务、云同步和多设备。
- 自动压缩摘要可能遗漏细节；费用为本地估算，最终以服务商账单为准。
- 安装包未签名，暂无自动更新。

更多说明请阅读仓库中的 [README](../README.md)。
