# Mind 全量功能推演测试报告

- 日期：2026-11-18
- 测试方式：代码级推演（读源码模拟「用户操作 → 代码路径 → 结果」），未启动 GUI
- 范围：主动澄清（AskBlock）、长期记忆（recall）、聊天娱乐模式、提示词路由、上下文/费用/搜索/连接器/数据备份
- 结论速览：5 个模块中 2 个 ✅ 通过、2 个 ⚠️ 有问题、1 个 ❌ 存在功能级 bug（recall 记忆模式不生效）

---

## 一、分模块结果

### 1. 主动澄清（AskBlock） — ⚠️ 有问题

**代码路径**

- 协议定义：`src/lib/prompts.ts:55-73`（CLARIFY_PROTOCOL，要求所有问题放进一个 ` ```ask ` 块，Qn 行 + `- 选项` 行）
- 前端解析：`src/components/AskBlock.tsx:18-54`（`parseQuestions`）、`56-77`（`splitAskBlocks`）
- 渲染：`MessageItem.tsx:271-273`（非流式时挂 `AskRenderer`）；`AskBlock.tsx:79-209`（`AskBlock`）、`216-249`（`AskRenderer`）
- 提交：`AskBlock.tsx:238-241` → `markQuestionAnswered(messageId)` + `send(text, [])`；兜底标记：`chat.ts:919-927`

**推演结果**

1. ✅ 混合选项/填空解析正确：`parseQuestions`（AskBlock.tsx:31-50）以 Qn 行开始新问题、`-` 行归入当前问题的选项；无选项时 `fillable` 为 true 渲染输入框（AskBlock.tsx:137、170-183）。
2. ⚠️ **提交语义不符合直觉（核心问题，见第二节 P1）**：
   - 用户只点选项不点提交（AskBlock.tsx:154-156）→ 不发任何消息，选择静默保留在本地；
   - 什么也不答直接点「提交回答」（AskBlock.tsx:94-106）→ 发送 `请继续，我没有更多补充信息。`；
   - 用户「跳过澄清、在输入框自由回答」（AskBlock.tsx:202 的文案承诺可以这样做）→ `send()` 里 `chat.ts:921-927` 会把**最后一条**含 ` ```ask ` 的助手消息直接标为已答，用户实际上什么也没回答。
3. ⚠️ **重复点击/已答状态存在理论上的双发窗口**：`AskBlock.tsx:238-241` 先 `markQuestionAnswered` 再 `send`；`answered` 来自 zustand 订阅（AskBlock.tsx:227），按钮 `disabled` 是同一渲染帧的 props（AskBlock.tsx:153、172、192）。若两次点击落在同一帧内（React 批处理），第二次点击的 `disabled` 尚未生效，会调用两次 `send`。`send()` 的防重入（`chat.ts:893`）依赖 `streaming` 已非空（`startAssistant` 先 `insertMessage` 再设 `streaming`，chat.ts:745-771），而 `insertMessage` 是 await 的 IPC 调用——快速双击时两次 send 都在同一次任务里同步走到 `state.streaming` 检查（此时仍为 null），理论上两条回答都会插入并发两个助手请求。概率极低，但属于未防护的重复 send。
4. ⚠️ **已答状态不持久化**：`answeredQuestions` 是内存 map（chat.ts:49、836），重启/切对话再切回后同一组澄清题会再次可点（重新回答）。不是数据错误，但用户会困惑「我明明答过了」。
5. ⚠️ 边界解析缺陷（低）：
   - 选项行必须紧贴 Qn 行，空行会 `flush()`（AskBlock.tsx:33-36），若模型按协议在问题间留空行（协议示例 prompts.ts:61-68 中 Q1/Q2 之间确实有空行），**选项会被丢弃**（`!current` 时 `continue`，AskBlock.tsx:39），Q2/Q3 变成填空。协议示例与解析器不一致，依赖模型「恰好不加空行」。
   - 非 Qn 开头的行被当成「填空问题」并分配自动 id（AskBlock.tsx:47-48）：如果模型违反协议在块内写叙述性文字，会渲染出一堆带输入框的伪问题。
   - 提交文案把问题文本拼回去：`1. 你的目标是？：A. 快速出个可用版本（推荐）`（AskBlock.tsx:99），带括号选项与「（推荐）」字样原样回传给模型，略啰嗦但无 bug。

**复现步骤（P1）**：开「主动澄清」→ 发信息不足的问题（如「帮我写个爬虫」）→ AI 返回可点击选项 → 点选「A. 快速出个可用版本」→ 观察：没有任何反应、也没有消息发出 → 必须再点「提交回答」。

---

### 2. 长期记忆（memoryRecall + chat store） — ❌ 有功能级 bug

**代码路径**

- 前端挑选：`src/lib/memoryRecall.ts:36-64`（`pickRelevantMemories`）+ `src/store/chat.ts:359-375`（`pickMemoriesFor`）
- 请求构造：`chat.ts:773-776`（`useMemory && longTermMemory ? pickMemoriesFor(...) : []`）、`810`（`memoryRecall` 传入）
- 后端：`src-tauri/src/chat.rs:381-407`（memory 注入 system message）；`src-tauri/src/models.rs:211`（`memory_recall: Option<String>`）
- 设置 UI：`SettingsView.tsx:735-769`（单开关同时写 `useMemory`+`longTermMemory`；「最近记忆 / 相关记忆」二选一段落）

**推演结果**

1. ❌ **「相关记忆（省 token）」模式后端完全不生效**：`ChatRequest.memory_recall`（models.rs:211）被序列化后在 `chat.rs` 中**从未被读取**——`build_messages` 只消费 `request.memories`（chat.rs:383）。前端 `pickMemoriesFor`（chat.ts:359-375）确实在 `memoryRecall === "recall"` 时按当前最后一条用户消息跑关键词打分（memoryRecall.ts:36-64），所以功能在前端这一侧是真实存在的；`memory_recall` 字段是纯摆设。
   - **实际影响（用户可感知）**：README:147 声称「记忆最多注入最近 12 条」，但 Rust 侧 `build_messages` 的上限是 **24 条**（chat.rs:384、391，单条截 200 字，总预算 clamp(400, ctx/4, 2400)）——README 与代码不一致。
   - 建议修法：要么删除 `memory_recall` 字段（避免误导后续维护者），要么在后端按其含义做截断/过滤；同时把 README 的「12 条」改成 24 条或反向对齐。
2. ✅ recall 打分逻辑本身合理（memoryRecall.ts）：
   - 空查询兜底正确：`tokenizeCjk` 返回空集时直接取最近 n 条（memoryRecall.ts:42-44）；所有记忆 0 命中时退回最近 n 条（memoryRecall.ts:59-61），注释明确说「避免注入无关内容」。
   - 查询取的是**压缩后**历史里最后一条用户消息（chat.ts:368-369 的 `history` 即 `requestHistory`），与注入的记忆预算同源，逻辑自洽。
   - tiebreak 只在 overlap>0 时按新旧（memoryRecall.ts:54），防止「最新但无关」的记忆压过「较旧但相关」的记忆——设计正确。
3. ⚠️ **两个记忆开关同时存在，用户困惑（见 P3）**：`useMemory` 与 `longTermMemory` 语义重叠。设置页只有一个合并开关（SettingsView.tsx:735-738，`checked={useMemory && longTermMemory}`，onChange 同时写两者）；`chat.ts:774` 与 `801` 都用 `useMemory && longTermMemory`。当前 UI 下二者永远同值，`longTermMemory` 实际是历史残留字段。
   - 风险：若未来有人只改其中一个（比如 `updateSettings({ longTermMemory: false })`），注入静默关闭且设置页开关仍显示「开」（`useMemory` 还是 true），状态与 UI 脱节。
   - 建议：合并为一个字段，或让设置页开关绑定其中之一。
4. ⚠️ recall 模式对**英文短语**召回偏弱：`tokenizeCjk` 对非 CJK 只取长度 ≥2 的整词（memoryRecall.ts:23-28），「react hooks」「react native」与记忆「React Hooks 教程」能命中整词；但短词（「ts」）、缩写（「PR」→「pr」）与 CJK bigram 的混排场景，命中率依赖整词完全一致，用户可能感知为「相关记忆没用」。属已知取舍，非 bug。

---

### 3. 聊天娱乐模式（Composer + Settings） — ✅ 基本通过（1 处文案小矛盾）

**代码路径**

- 总开关默认隐藏：`types.ts:295-298`（`chatMode: false`，注释「默认 false，关闭时连选项都不出现」）
- Composer：`src/components/Composer.tsx:245-259`（仅 `settings.chatMode && !settings.demoMode` 时渲染「聊天」按钮）；`:97-118`（`toggleChatMode`）；`:316-324`（底部状态文案）
- 设置页：`src/components/SettingsView.tsx:248-279`（「聊天娱乐模式」卡片 + 首次开启 confirmDialog + `chatModeAck`）

**推演结果**

1. ✅ **默认隐藏**正确：`DEFAULT_SETTINGS.chatMode = false`（types.ts:326），Composer 按钮条件渲染（Composer.tsx:245），用户不主动去设置页开启就完全看不到这个功能——符合「默认隐藏」需求。
2. ✅ **首次开启弹窗**正确且双端一致：
   - Composer 路径：`chatModeAck` 为 false 时动态 import `confirmDialog`（Composer.tsx:108-117），确认后才写 `{ chatMode: true, chatModeAck: true, thinking: false }`；取消则 `chatMode` 保持 false。
   - 设置页路径：SettingsView.tsx:264-276 同样先 confirm、确认后写 ack。
   - 弹窗文案两处一致（「省 token、不适合生产力使用」），用户无论从哪进都能触发，只弹一次（ack 持久化后不再弹）。
3. ✅ **开启后「聊天」按钮出现**：`settings.chatMode === true` 时 Composer.tsx:245 渲染，按钮高亮为紫色（`#7c5cff`，Composer.tsx:252-253），与常规 accent 色区分，视觉上有「娱乐」暗示。
4. ✅ **关闭逻辑**：再点一次（此时 `settings.chatMode` 为 true）走 Composer.tsx:98-102 直接关，并把 `thinking` 一并置 false——因为 chatMode 与 thinking 在提示词路由里互斥（prompts.ts:102-113 的 if/else if），关闭娱乐模式时顺带关掉思考开关，避免「关娱乐但留着思考」的状态残留。合理。
5. ⚠️ **设置页文案与 Composer 实际行为小矛盾（低）**：SettingsView.tsx:257 写「开启后聊天框才会出现『聊天』按钮」，暗示按钮**只在开启后才存在**；但 Composer.tsx:245 的条件是 `settings.chatMode`，即按钮确实只在开启后出现——文案其实是对的。真正的矛盾在：用户开启后点按钮会直接**关闭**娱乐模式（Composer.tsx:98-102），而不是「切换主题/风格」，按钮 title（Composer.tsx:248）没说明这点，首次点击的用户可能困惑「为什么按钮变成了关闭」。建议 title 动态化：开启态写「点击退出聊天娱乐模式」。
6. ✅ 底部状态文案（Composer.tsx:316-324）：压缩中 > 演示模式 > 娱乐模式 > 默认，优先级合理，娱乐模式提示「省 token、不适合生产力」与设置页弹窗文案一致。
7. ⚠️ 演示模式下娱乐按钮隐藏（Composer.tsx:245 的 `!settings.demoMode`），但演示模式的 mock 回复（chat.rs:1207-1229 的 `MOCK_ANSWER`）不会因 chatMode 改变口吻——演示模式里开娱乐模式无实际效果，属已知限制（演示模式本身不接真实模型），非 bug。

---

### 4. 提示词路由（`buildSystemPrompt`） — ⚠️ 有矛盾/重复风险

**代码路径**：`src/lib/prompts.ts:97-132`（`build()`）；调用点 `chat.ts:799-809`。

**组合矩阵推演**

| chatMode | thinking | clarify | visual | 结果 | 评价 |
| --- | --- | --- | --- | --- | --- |
| ✅ | ✅ | ✅ | ✅ | 矛盾：`chatMode` 分支（prompts.ts:102-104）只叠加 `CLARIFY_PROTOCOL`，**完全丢弃** `COMPLEX_STYLE`、`VISUAL_PROTOCOL`；用户以为同时开了「深度思考」和「可视化」，实际提示词里只有娱乐风格 + 澄清协议 | ❌ 高：开关状态与提示词内容脱节，用户困惑「为什么开了可视化不画图」 |
| ✅ | ✅ | ❌ | ✅ | 同上，视觉协议被静默丢弃 | ❌ 高：同上 |
| ✅ | ❌ | ✅ | ✅ | 正确：娱乐 + 澄清 + 可视化都进提示词 | ✅ |
| ❌ | ✅ | ✅ | ✅ | 正确：复杂风格 + 澄清 + 可视化，三者互不冲突（COMPLEX_STYLE 已含 Mermaid/chart 提示，VISUAL_PROTOCOL 与之一致） | ✅ |
| ❌ | ❌ | ✅ | ✅ | 正确：日常风格 + 澄清 + 可视化 | ✅ |

**具体问题**

1. ❌ **chatMode 与 thinking 互斥但未在 UI 阻止**：`prompts.ts:102-113` 用 if/else if 实现「chatMode 优先」，Composer 关闭娱乐模式时顺带关 thinking（Composer.tsx:100、105），但**开启** thinking 时不检查 chatMode（Composer.tsx:213-227 的 thinking 按钮无条件 `updateSettings({ thinking: !settings.thinking })`）。用户可以先开娱乐、再开深度思考，两个按钮同时高亮，但提示词走的是 chatMode 分支（prompts.ts:102）——thinking 实际未生效。建议在 Composer 里让 thinking 按钮在 chatMode 开启时禁用或提示「娱乐模式下深度思考不生效」。
2. ⚠️ **clarify 在三个分支都叠加但文案不区分风格**：`prompts.ts:104、107、111` 三处都 `if (opts.clarify) parts.push(CLARIFY_PROTOCOL)`，澄清协议本身风格中性（「先简短说明…再给出回答」），与三种风格都不冲突，✅ 通过。
3. ⚠️ **customInstructions 追加在最后，可能覆盖前面的「身份恒定」**：`prompts.ts:128-130` 把用户自定义指令放最后（`## 用户自定义指令`），若用户写了「你是一个…」类指令，会覆盖 IDENTITY（prompts.ts:26-29）的「始终自称 Mind」。属可接受的设计（用户指令优先），但建议在设置页 placeholder（SettingsView.tsx:243）加一句「自定义指令优先级高于默认风格」。
4. ✅ **视觉/工具/搜索协议互不重复**：`VISUAL_PROTOCOL`（prompts.ts:75-84）只在 thinking 与日常分支叠加，chatMode 分支不叠加（见上）；`TOOL_PROTOCOL`（86-90）与 `WEBSEARCH_PROTOCOL`（92-95）独立于风格分支，无重复。
5. ⚠️ **演示模式下提示词仍按真实开关构造**：`chat.ts:800` 传 `demoMode: settings.demoMode`，`prompts.ts:123-126` 会追加「当前为演示模式…涉及实时信息请说明局限」——但演示模式的 mock 回复（chat.rs:1207-1229）根本不走 `buildSystemPrompt`（`run_mock` 不读 `request.system_prompt`），这段提示词在演示模式下**完全无效**，属死代码路径（低，不影响真实使用）。

---

### 5. 上下文 / 费用 / 搜索 / 连接器 / 数据备份 — ⚠️ 多处 README 与代码不一致

**对照结果**（README 声称 vs 代码实际）

| 功能 | README 位置 | 代码位置 | 判定 |
| --- | --- | --- | --- |
| 上下文预设 4k/8k/16k/100k/完整 | README:47 | SettingsView.tsx:64-70（`CONTEXT_PRESETS` 与 README 一致，默认 100k） | ✅ |
| 超出 85% 自动压缩 | README:47 | chat.ts:214（`total <= budget * 0.85` 才跳过压缩） | ✅ |
| 记忆最多注入 12 条 | README:147 | chat.rs:384（`memory_lines.len() >= 24`）、391（单条 200 字） | ❌ **README 写 12，代码 24** |
| 费用「约 X 分」显示在对话标题栏 | README:50 | ConversationCost.tsx:28（`≈{formatFen(...)}`，挂在 ChatView.tsx:164） | ✅ |
| DeepSeek 官方峰谷价自动估算 | README:155 | pricing.ts:10-16（`DEEPSEEK_USD` + `DEEPSEEK_PEAK_LABEL`） | ✅ |
| 联网搜索多轮工具历史 | README:48 | chat.rs:744-776（累积 `tool_calls`）、951-1183（工具循环 max 4 轮） | ✅ |
| 连接器授权框 | README:177 | chat.rs:1064-1081（`emit` 授权事件 + `wait_for_approval`）、ConnectorPanel.tsx（前端渲染） | ✅ |
| GitHub 只读 6 工具 | README:188-194 | github.rs（`definitions()`、`call_tool`）、chat.rs:916-936（注入工具路由） | ✅ |
| 备份导出/导入 JSON | README:51 | DataSettings.tsx:54-160（导出/导入/覆盖）、src-tauri/src/data.rs | ✅ |
| 局域网自动同步 | README:229、290 | DataSettings.tsx:258-271（明确写「暂未实现」） | ✅（诚实声明） |
| 峰时 09:00–12:00/14:00–18:00 工作日 | README:157 | pricing.ts:30-37（`isPeakTime`，不含节假日） | ✅（代码与 README 一致，均声明节假日不建模） |
| 「除长期记忆外不添加额外系统提示词」 | README:146 | prompts.ts:97-132 总是拼 IDENTITY + 风格块；chat.ts:799-809 每次请求都传 `systemPrompt` | ⚠️ **README 声称「不添加」，代码每次都发一个含身份/风格/协议的 system prompt**（长度数百到上千字，计入上下文预算） |
| 自动记忆提取用 Flash | README:49、715 | chat.ts:101-106（`api.memoryAutoExtract(providerId, modelId, ...)` 传入的是**当前** modelId，非强制 Flash） | ⚠️ README 写「默认使用 Flash」，代码直接复用当前模型 |

**具体不一致清单**

1. ❌ **记忆条数 12 vs 24**（README:147 vs chat.rs:384）：文档与代码硬编码不一致，用户看到的「最多 12 条」实际是 24。修法：改 README 或改代码，二选一对齐。
2. ⚠️ **「不添加额外系统提示词」与实现矛盾**（README:146 vs prompts.ts）：代码每次请求都注入 IDENTITY + 风格 + 按需协议（澄清/可视化/工具/搜索），README 却称「除长期记忆外不添加额外系统提示词」。实际这些提示词会占上下文预算（chat.rs:456 的 `system_cost` 计入 `available`），用户按 README 理解会低估 token 消耗。修法：README 改为「默认注入轻量身份与风格提示词；开启相应开关后追加对应协议」。
3. ⚠️ **自动记忆提取模型**（README:715「DeepSeek 默认使用 Flash」 vs chat.ts:101-106 传当前 modelId）：若用户当前模型是 Pro，自动提取也会用 Pro（更贵）。修法：chat.ts 里把 `modelId` 强制改写为 `flash`（需确认 DeepSeek 模型 id 常量），或 README 删除「Flash」字样。
4. ✅ 上下文/压缩/费用/搜索/连接器/备份主链路均与代码相符，无「声称有但没做」的硬伤（局域网同步已诚实标注「暂未实现」）。

---

## 二、不符合用户使用逻辑的问题（按严重程度）

### P1（高）—— AskBlock 提交语义

- **现象**：用户在 AI 的 ` ```ask ` 块里点选「快速出个可用版本」，界面没有任何反馈、也没有消息发出；必须再找「提交回答」按钮。用户自然直觉是「点了选项就等于回答了」。
- **根因**：`AskBlock.tsx:154-156` 的选项点击只更新本地 `selections` 状态，不调用 `onSubmit`；`AskBlock.tsx:94-106` 的 `answer` memo 只有在点提交或回车时才拼出文本；`AskBlock.tsx:103` 的空提交兜底是「请继续，我没有更多补充信息」，与「我选了 A」语义相反。
- **建议修法**：选项点击后自动把该选项计入待提交答案，并在所有问题都已选中时**自动发送**（或在 UI 上显示「已选：A. 快速出个可用版本 · 点击发送」的预览态）；若混合了填空题，则至少显示一个「已选 X / 待填 Y」的进度提示，避免用户误以为点选即生效。

### P2（高）—— 跳过澄清的自由回答被静默标记为已答

- **现象**：AI 给出 3 个澄清选项，用户不想回答、直接在输入框打字回答原问题（AskBlock.tsx:202 的文案明确允许「也可以直接在输入框里自由回答」）；但 `chat.ts:921-927` 会把最后一条含 ` ```ask ` 的助手消息标为已答，用户实际**没有回答**任何澄清项。
- **根因**：`chat.ts:921-927` 的「兜底标记」逻辑把「任意一次 send」等同于「回答了澄清」，没有区分「这是澄清答案」还是「这是新的自由输入」。
- **建议修法**：`send()` 增加一个 `fromAskBlock` 标志（AskBlock 提交时传 true），只有该标志为 true 或用户输入与澄清问题明显对应时才标记已答；或者干脆去掉兜底标记，改为「用户主动跳过」的明确交互（比如在 AskBlock 里加「跳过，直接回答」按钮）。

### P3（中）—— `useMemory` / `longTermMemory` 双开关

- **现象**：`types.ts:283` 与 `300` 两个字段语义重叠，`chat.ts:774`、`801` 都用 `useMemory && longTermMemory`；设置页（SettingsView.tsx:735-738）用一个合并开关同时写两者。当前 UI 下二者永远同值，用户看不到差异；但代码层面 `longTermMemory` 是纯冗余字段，未来若有人单独改其中一个，注入会静默关闭而设置页开关仍显示「开」。
- **根因**：字段拆分未合并，UI 层做了兼容但底层数据模型未清理。
- **建议修法**：保留 `longTermMemory` 作为唯一字段（语义更清晰：「是否启用长期记忆」），把 `useMemory` 的引用全部改到 `longTermMemory`；或反向，删掉 `longTermMemory`、让 `useMemory` 独挑大梁。迁移时做一次设置数据合并。

### P4（中）—— chatMode 与 thinking 互斥但 UI 无提示

- **现象**：用户开启「深度思考」按钮（Composer.tsx:215）后，若「聊天娱乐模式」也处于开启状态，提示词路由走 chatMode 分支（prompts.ts:102-104），thinking 实际未生效；但 Composer 里 thinking 按钮仍显示为高亮（Composer.tsx:219-222），用户以为思考在跑。
- **根因**：`prompts.ts:102-113` 的互斥逻辑未反映到 UI 状态；Composer 的 thinking 按钮不检查 chatMode。
- **建议修法**：thinking 按钮在 `settings.chatMode` 为 true 时禁用并显示 tooltip「娱乐模式下深度思考不生效，请先退出娱乐模式」；或在开启 thinking 时自动关 chatMode（与 Composer.tsx:100 的对称逻辑一致）。

### P5（中）—— 记忆注入条数 README 与代码不一致（12 vs 24）

- **现象**：README:147 写「记忆最多注入最近 12 条」，chat.rs:384 实际 `memory_lines.len() >= 24` 才截断。用户按 README 预期 12 条，实际 24 条，token 消耗比预期高。
- **根因**：README 与代码硬编码未同步（可能代码后来从 12 改到 24 没更新文档，或反之）。
- **建议修法**：二选一对齐。若产品意图是 12，改 chat.rs:384 为 `>= 12`；若是 24，改 README:147 为 24 并说明单条 200 字上限。

### P6（低）—— 设置页「聊天娱乐模式」文案与 Composer 按钮 title 不一致

- **现象**：SettingsView.tsx:257 说「开启后聊天框才会出现『聊天』按钮」，用户点按钮期望「在娱乐/正常之间切换风格」，但 Composer.tsx:98-102 实际是「关闭娱乐模式」。按钮 title（Composer.tsx:248）未说明点击行为。
- **根因**：按钮 title 是静态文案，未随 `settings.chatMode` 状态动态化。
- **建议修法**：Composer.tsx:248 的 title 改为 `settings.chatMode ? "点击退出聊天娱乐模式" : "开启聊天娱乐模式"`；或在按钮旁加一个「正常 / 娱乐」的二段切换，而非单按钮 toggle。

### P7（低）—— 演示模式下「深度思考」「联网搜索」按钮仍可见

- **现象**：`SettingsView.tsx:520-542` 允许用户在「模型连接」页开启演示模式；开启后 Composer 的 thinking 按钮（Composer.tsx:213-227）和 webSearch 按钮（Composer.tsx:229-243）仍渲染（`supportsThinking`/`supportsWebSearch` 只看模型元数据，不看 demoMode）。用户点 thinking 按钮，`updateSettings({ thinking: true })` 成功写入设置，但演示模式的 mock 回复（chat.rs:1238-1247）不会因 thinking 改变口吻——按钮高亮但无实际效果。
- **根因**：Composer 的 thinking/webSearch 按钮渲染条件未排除 demoMode。
- **建议修法**：两个按钮在 `settings.demoMode` 时禁用并加 tooltip「演示模式下不产生真实思考/搜索」。

### P8（低）—— 澄清协议示例与解析器不一致（空行会丢选项）

- **现象**：`prompts.ts:61-68` 的 CLARIFY_PROTOCOL 示例里 Q1/Q2 之间有空行，但 `AskBlock.tsx:33-36` 的 `parseQuestions` 遇到空行就 `flush()`，若模型照抄示例在问题间加空行，**选项行会被丢弃**（Q2/Q3 变成填空）。
- **根因**：协议示例与解析器实现未对齐。
- **建议修法**：二选一对齐——要么改示例去掉空行（更简单），要么改解析器允许空行不 flush（把 `!line` 时改为 `continue` 而不是 `flush()`，保留当前问题的选项归属）。

---

## 三、Top 5 必修

1. **P1（高）**—— AskBlock 选项点击无发送反馈，提交兜底文案「请继续，我没有更多补充信息」与用户点选语义矛盾。**修法**：选项点击后在 UI 上明确显示已选状态与「发送」按钮联动；或在所有选择题均已选中时自动提交。文件：`src/components/AskBlock.tsx:154-156、94-106`。
2. **P2（高）**—— 跳过澄清的自由回答被静默标记为已答。**修法**：`send()` 增加 `fromAskBlock` 标志，只有 AskBlock 主动提交时才标记；或在 AskBlock 加「跳过，直接回答」按钮。文件：`src/store/chat.ts:919-927`、`src/components/AskBlock.tsx:238-241`。
3. **P5（中）**—— 记忆注入条数 README 写 12、代码实际 24。**修法**：对齐 README:147 与 `chat.rs:384`，二选一。同时清理 `memory_recall` 字段（前端有、后端不用，见第二节模块 2）。
4. **P4（中）**—— chatMode 与 thinking 互斥但 UI 无提示，thinking 按钮在 chatMode 开启时仍高亮。**修法**：Composer.tsx:213-227 的 thinking 按钮在 `settings.chatMode` 为 true 时禁用并加 tooltip；或开启 thinking 时自动关 chatMode。
5. **P3（中）**—— `useMemory` / `longTermMemory` 双开关冗余。**修法**：合并为单字段，迁移设置数据，更新 `chat.ts:774、801` 与 `SettingsView.tsx:735-738`。

---

## 四、附：各模块判定汇总

| 模块 | 判定 | 关键问题 |
| --- | --- | --- |
| 1. 主动澄清 AskBlock | ⚠️ | P1 提交语义、P2 静默标记、P8 协议示例与解析器不一致、重复点击双发窗口 |
| 2. 长期记忆 memoryRecall | ❌ | `memory_recall` 后端未消费（纯摆设）；README 12 条 vs 代码 24 条；`useMemory`/`longTermMemory` 冗余 |
| 3. 聊天娱乐模式 | ✅ | 默认隐藏/首次弹窗/按钮出现/状态文案均正确；P6 按钮 title 小文案、P7 演示模式下 thinking/webSearch 按钮仍可见 |
| 4. 提示词路由 | ⚠️ | P4 chatMode 与 thinking 互斥无 UI 提示；chatMode 分支静默丢弃 visual 协议；演示模式提示词无效（死代码） |
| 5. 上下文/费用/搜索/连接器/备份 | ⚠️ | README「不添加额外系统提示词」与代码矛盾；自动记忆提取模型 README 写 Flash、代码用当前模型；其余主链路一致 |

---

## 五、修复状态（本轮已修）

| 问题 | 状态 | 改动位置 |
| --- | --- | --- |
| P1 提交语义无反馈 | ✅ 已修 | `AskBlock.tsx` 提交按钮动态文案「提交（已选/填完可直接提交）」+ 进度「已回答 N/M」；空提交兜底文案改为「跳过澄清直接回答」 |
| P2 自由回答被误标已答 | ✅ 已修 | `send(text, atts, fromAskBlock)` 新增标志；仅 AskBlock 主动提交时标记已答 |
| P4 chatMode 与 thinking 互斥无提示 | ✅ 已修 | `Composer.tsx` thinking 按钮在 chatMode 开启时 `disabled` + tooltip「娱乐模式下深度思考不生效」 |
| P5 README 记忆 12 vs 代码 24 | ✅ 已修 | `README.md:147` 改 24；同时修「不添加额外系统提示词」矛盾句 |
| P3 useMemory/longTermMemory 冗余 | ✅ 已修 | 合并为 `longTermMemory` 单字段，`useMemory` 保留为可选迁移字段；`app.ts parseSettings` 做一次性迁移 |
| P6 聊天按钮 title 静态 | ✅ 已修 | `Composer.tsx` 按钮 title 随 chatMode 状态动态化 |
| P7 演示模式下 thinking/webSearch 仍可见 | ✅ 已修 | thinking 按钮增加 `!settings.demoMode` 条件（webSearch 原本已有） |
| P8 空行丢选项 | ✅ 已修 | `parseQuestions` 空行不再 `flush()`，选项归属最近的 Qn |
| 自动记忆提取模型 | ✅ 已修 | `memory.rs` 非 DeepSeek 也优先挑 flash/mini/haiku 轻量模型，与 README 一致 |
| `memory_recall` 后端不消费 | ✅ 已处理 | 该字段仅对称占位（实际召回在前端 `pickMemoriesFor` 完成）；README 记忆条数 24 已对齐，无误导性文档残留，保留字段不删除（后端按 `request.memories` 注入，行为正确） |
| 已答状态不持久化（重启重弹澄清） | ⏸ 记录在案 | 低优先级 UX 项，不影响数据正确性；如需持久化可后续加 `answeredQuestions` 写 SQLite。本轮未改，避免扩大改动面 |

## 2026-11-18 记忆功能补齐（后续修复）

- 旧设置迁移：没有 `memoryVersion` 的设置会一次性开启 `autoMemory`（明确关闭过“使用记忆”的用户保持关闭），修复老用户自动记忆实际未开启的问题。
- 提取与注入解耦：自动提取只受 `autoMemory` 控制；`longTermMemory` 只控制是否把记忆注入请求。
- 增加消息级“保存到长期记忆”书签、记忆页“从当前对话补记”、记忆搜索与日期/来源展示。
- 自动提取失败不再静默，首次失败会提示原因。
- 自动提取增加近似去重（字符 + bigram Jaccard），手动保存增加精确去重。
- 验证：`cargo test --lib` 14 项通过；本地 OpenAI 兼容 Mock 端到端验证旧设置迁移、自动提取、去重、注入、关闭注入后继续提取、手动保存与立即提取。

## 2026-11-18 记忆引擎 v1 与交互修复

- 修复 `AskBlock` 解析：此前把已去掉围栏的正文再次按围栏解析，导致选项/文本框完全不渲染；现在选项直接渲染。
- 单选选项点按即发送；多选全部答完后自动发送；文本题显示独立 textarea 和「发送回答」；Markdown 不再重复展示 `ask` 源代码块。
- 记忆升级为结构化记录：类型（档案/偏好/项目/事件/知识）、主题、置信度、重要度、状态、有效期、来源消息。
- SQLite 迁移新增 `memory_versions`、`memory_sources` 和可选的 FTS5 索引；FTS 不可用时自动回退 LIKE。
- 同主题新事实会替代旧事实并保留版本；自动提取、手动整理、删除都会同步索引与来源。
- 新增混合召回：FTS5 + 关键词 + 重要度/置信度/时效/类型权重；聊天请求通过后端召回而不是把全部记忆塞进上下文。
- 记忆页新增分类统计/筛选、搜索、整理记忆、来源对话、历史版本与“为什么记得”详情。
- 图表增强：坐标轴、数值标签、折线面积、环图、百分比、SVG 下载；Mermaid 增加复制/下载和主题排版。
- 验证：`cargo test --lib` 16 项通过；本地 Mock 验证 FTS 搜索、结构化提取、来源消息、同主题替代、整理、历史、删除索引清理；AskBlock 选项点按和文本提交均在运行中的 WebView 验证。
