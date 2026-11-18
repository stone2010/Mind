# 回归问题复盘（用户反馈后修复）

> 触发：用户反馈"回复开始时一个字体、过一会跳成另一种字体" + 截图里 chart 红框"无法解析"。
> 复盘结论：这两处**都是我前几轮改动引入的回归**，不是原有 bug。已修复并验证。

## 问题 1：流式回复字体跳变 ❌→✅
- **现象**：回复刚开始是一种字体，几秒后"跳"成另一种。
- **根因**：我上一轮为"避免半截 ```ask 围栏被误渲染"，把流式内容改用 `<pre>`（等宽体 Cascadia/Consolas）渲染；回复结束切回 `<Markdown>`（正文 Segoe UI）→ 字体突变。
- **修复**：`Markdown` 组件新增 `live` 参数；流式与完成态**统一用 Markdown**（同一字体）。`live=true` 时，未闭合的 mermaid/chart/ask 围栏先按普通代码块显示，稳定后才交给对应渲染器——既不变字体，也不乱渲染。
- **文件**：`src/components/Markdown.tsx`（live 支持）、`src/components/MessageItem.tsx`（删除 pre 分支）。

## 问题 2：chart "无法解析" 红框 ❌→✅
- **现象**：截图里模型输出 chart 后显示红色"无法解析 chart 代码块，需要 JSON 数据"。
- **根因（两层）**：
  1. 我写的提示词示例**本身是非法 JSON**：`...,"data":{"labels":...,"series":...}}` 多了一个 `}`，且把 `series` 嵌套进 `data`。模型照抄就生成 `"series":{{...}}`（对象非数组 + 语法错误）。
  2. `ChartBlock.parseChart` 太脆弱：只认顶层 `parsed.series` 数组，遇到对象/嵌套/语法错就 `return null` → 红框。
- **修复**：
  1. 提示词示例改为**合法 JSON**、顶层平铺、并明确"series 必须是数组 []、不要嵌套 data、只输出纯 JSON"。
  2. `parseChart` 增强容错：支持 `series` 写成对象、嵌套在 `data` 里、值在 `values` 字段等变体，尽量解析成功。
  3. 解析失败时**不再用刺眼红框**，改为中性提示 + 展示原始数据 + 建议"重新生成或改用列表/表格"。
- **文件**：`src/lib/prompts.ts`、`src/components/ChartBlock.tsx`。
- **验证**：`tsx` 跑 4 种输入（含截图那条）——正确格式与"series 对象"已能解析；截图那条因 JSON 本身语法非法（`{{`）仍无法救，但前端已优雅降级，不再红框报错。

## 问题 3：娱乐模式悄悄缩水工具/搜索/可视化 ❌→✅
- **现象**：开"聊天娱乐模式"后，提示词路由**丢弃**了 visual / hasTools / webSearch 协议，用户仍期待出图/用工具时能力降级且无提示。
- **修复**：娱乐模式分支也叠加 visual/tools/websearch 协议（风格切换 ≠ 能力缩水）。
- **文件**：`src/lib/prompts.ts` `build()`。

## 验证状态
- ✅ `tsc --noEmit` 0 错误
- ✅ `vite build` 成功
- ✅ `cargo test` 11/11
- ✅ `tsx` 实测 chart 解析 4 场景

## 遗留（已知、低风险）
- 模型若输出**语法非法** JSON（如 `{{`），无法解析——已通过"优雅降级 + 提示词约束"缓解，属模型行为边界。
- 已答澄清状态仍未持久化（重启会重弹），属低优先级 UX 项。
