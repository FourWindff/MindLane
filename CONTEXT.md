# MindLane 领域词汇表

## 身份标识

### fileUuid

- 一个 `.mindlane` 文件的长期稳定身份。
- 在文件**首次创建**时生成，写入 `metadata.fileUuid`。
- 同路径覆盖保存时保留原 `fileUuid`。
- `fileSaveAs` 另存为新路径时生成新 `fileUuid`，视为新文件。
- workspace 内 rename/move 保留 `fileUuid`。
- 跨 workspace 拷贝或外部复制产生重复 `fileUuid` 时，给副本分配新 `fileUuid`。
- 删除后重新创建同名文件生成新 `fileUuid`。

### workspaceUuid

- 一个 workspace 目录的长期稳定身份。
- 在 workspace **首次被 MindLane 初始化**时生成，写入 `.mindlane/state.json` 的 `workspaceUuid`。
- 用于会话与 checkpoint 的目录索引，替代基于路径哈希的 `workspaceHash`。
- MindLane 维护一个全局索引 `workspaceUuid -> workspacePath`。
- 加载 workspace 时，若索引中的原路径已不存在，视为外部移动/改名，保留 `workspaceUuid` 并更新索引指向新路径。
- 若索引中的原路径仍存在且与新路径不同，视为 workspace 被复制，给当前副本生成新 `workspaceUuid` 并新建会话目录。
- 删除 `.mindlane/state.json` 后重新打开，生成新 `workspaceUuid`；旧会话目录保留但不再关联。

### sessionId

- 一次完整对话的身份，由前端在“新建对话”时生成。
- 一个 `sessionId` 绑定到一个 `fileUuid`（通过 `SessionMeta.fileUuid`）。
- 同一 `fileUuid` 在同一时刻在内存中只有一个 `activeSessionId`。
- 新建对话会生成新 `sessionId`，旧 `sessionId` 成为该文件的历史会话。

### threadId

- 仅存在于跨进程契约中的 `sessionId` 别名，如 `chatStream({ threadId })` 与主进程 langgraph 的 `thread_id`。
- 渲染层不使用这个名字：当前会话一律叫 `activeSessionId`。

### streamId

- 单次流式请求的临时身份，由主进程 `StreamManager` 在请求开始时生成。
- 一轮请求结束后作废。
- 所有流事件都携带 `streamId` 和 `sessionId`。

### activeSessionId

- 一个 `fileUuid` 当前在聊天面板中显示的 `sessionId`。
- 保存在 workspace `state.json` 的 `activeSessionIds: Record<fileUuid, sessionId>` 中。
- 切换文件时自动加载对应 `sessionId` 的历史消息；若 `sessionId` 已被删除，则新建对话。

## 聊天界面组件

### ChatInputBar

- 应用底部居中的长条对话输入组件。
- 包含添加附件按钮、设置按钮、语音输入按钮、发送按钮。
- 附件按钮保持现有行为：打开文件选择器，选中的文档以标签形式显示在输入框上方，随下一次发送一起提交。
- 设置按钮打开全局设置面板。
- 语音输入按钮为纯视觉占位：长按时在输入框上方显示音频跳动动画，松开结束，不产生实际录音或转文本数据。
- 由 `shell` 统一布局，不再属于 `ChatPanel` 浮层面板。

### ChatMessageList

- 应用右方、位于 `ChatCapsuleBar` 下方的消息列表组件。
- 两种显示模式：
  - **消息模式**：按时间顺序渲染当前 `activeSessionId` 的用户与 AI 消息。
  - **会话列表模式**：点击当前激活胶囊上的“切换会话”按钮后，显示该文件的历史会话列表；选中会话后切回消息模式。
- 消息气泡为全宽矩形，所有气泡的左、右边缘对齐，文字全部左对齐。
- 消息列表无背景；消息气泡使用半透明玻璃状背景。

### ChatCapsuleBar

- 应用窗口右上方的文件级对话入口组件（原 `ActiveSessionsBar`）。
- 每个胶囊对应一个 `fileUuid`，展示文件名与当前对话状态：`generating`（生成中）、`stopping`（终止中）、`idle`（空闲）。
- 按用户最近一次输入时间排序，最近的排在最前；当前文件的胶囊排在首位并放大显示。
- 状态样式：`generating` 为绿色滚动边框，`stopping` 为红色滚动边框，`idle` 为灰色背景。
- 点击胶囊切换到对应文件并加载其 `activeSessionId`。
- 展开/收起按钮始终在胶囊组左侧；默认收起，点击展开后胶囊组整体向左平移（右边缘固定），展开按钮变为收起按钮并紧靠 `shell` 工具栏的文件名组件右侧。
- 当前激活胶囊右侧在鼠标悬浮时显示“切换会话”按钮，点击后将 `ChatMessageList` 切换到会话列表模式。

### ChatPanelToggle

- `shell` 工具栏中的聊天气泡图标按钮，用于显示或隐藏 `ChatInputBar` 与 `ChatMessageList`。
- 默认状态为显示；点击后图标反转，`ChatInputBar` 与 `ChatMessageList` 隐藏，`ChatCapsuleBar` 保持可见且可操作。

## 运行时组件

### Runner

- 单次流式请求的运行实例，由 `StreamManager` 在请求开始时创建。
- 持有自己的 `AbortController`。
- 启动时从 `StreamManager` 快照不可变工具列表。
- 负责完整闭环：加载历史、保存 user message、运行 graph、发送流事件、保存 AI/Tool messages、fire-and-forget memory 提取。
- 被停止时保存已生成的内容后结束。
- 运行结束后从 `StreamManager` 注销。

### StreamManager

- 主进程流管理层，由 `main.ts` 显式创建。
- 维护 `streamId -> Runner` 映射。
- 依赖 `aiService`、编译后的 graph、`ToolRegistry`、事件发送函数 `eventSink`。
- 提供 `startStream(request)` 返回 `streamId`，`stopStream(streamId)` 精确停止目标 runner。
- 不限制并发 runner 数量；暴露 `getActiveStreamCount()` 供 UI 观测。

### 会话压缩（Consolidation）

- 全系统**唯一**的 LLM 摘要机制，在每次 run 开始时由 `contextCompact` 节点执行（调用模型之前，无被动/无兜底摘要）。
- **滚动摘要**：每轮用 LLM 把「上一轮 `_lastSummary` + 新切片」合并为一份累积摘要，写入会话 meta 的 `_lastSummary` 并推进 `lastConsolidated` 游标；`_lastSummary` 的语义是**整段已压缩对话的累积**，不是最近切片。
- 摘要经 graph state 的 `summary` 字段注入 supervisor 的 system prompt `## 历史摘要` 段——归档的消息由摘要替代，不是静默截断。
- 会话文件只有 `{sessionId}.jsonl`（首行 meta + 消息，append-only 永不物理裁剪）；不再有 `{sessionId}.history.jsonl`。
- LLM 摘要失败**不推进游标**（下轮 run 自愈重试），本轮由预算裁剪兜底；I/O 故障跳过压缩，由 supervisor 的非 LLM 裁剪重试兜底。
- 摘要与记忆提取共用当前选定的聊天模型（模型层不设独立的"推理/对话"档位）；记忆提取（fire-and-forget）挂在压缩切片上，`lastConsolidated` 兼作提取游标。

### 监督器（Supervisor）

- 主图中负责路由决策与上下文管理的智能体（`MindLaneAgent`，图中 `supervisor` 节点）。
- 相对子图（导图子图、记忆宫殿子图）：子图做专项生成，监督器决定进入哪个子图、调用哪些工具、或直接作答。

### 系统提示（System Prompt）

- 监督器每轮模型调用的 system message 全文：助手角色与工具规则、环境与平台策略、相关记忆、滚动摘要（`## 历史摘要`）。
- 只包含**跨轮次逐字节稳定**的内容（稳定前缀）；易变上下文（编辑器状态）不进 system prompt，改由「轮次状态」附加到用户消息，以保住前缀缓存命中。
- 由 `buildSystemPrompt` 唯一构建：调用方只提供输入（能力开关、记忆管理器、滚动摘要），不编排段落。
- 新增或调整段落只有一个入口。

### 轮次状态（Turn State）

- 一次用户发送时点的编辑器状态快照：文件身份（fileUuid / filePath / fileTitle）与选中节点、附件、关联文档。
- 文件身份是**源头不变量**：文件在创建时即落盘（`createInDirectory`），uuid / path / title 创建即存在；下游（发送、Runner）不做任何存在性检查。
- 由主进程在消息持久化时从 `ChatContext` 序列化为 XML（根标签 `<EDITOR_STATE>`），附加到该轮用户消息的**末尾**，随消息一起持久化。
- 模型输入**不过滤**（必须看到状态）；展示、滚动摘要、记忆提取三个消费方复用同一 strip 函数按末尾锚定剥离。
- 模型每轮感知到的「当前导图上下文」只来自轮次状态与工具结果；不含导图全文摘要（`mindmapSummary` 已删除）。
- 模型需要导图结构（超出选中范围）时按需调用 `getMindmapContext` 读工具，主进程经反向 IPC 向渲染层实时拉取。
- _Avoid_: 把轮次状态注入 system prompt（破坏稳定前缀的缓存命中）。

### ChatStreamEvent

- 统一的流事件 IPC 结构，判别联合（discriminated union）：每个 `type` 成员自带 `payload` 的精确类型。
- `type` 包括 `token`、`message-start`、`tool-start`、`tool-end`、`step`、`end`、`error`。
- `token` / `error` 的 payload 为 `string`；`message-start` 为 `null`；`tool-start` / `tool-end` 为 `{ name, ... }`；`step` 的 payload 使用共享词表 `StreamStep`；`end` 的 payload 为 `StreamResponse`。
- `type` 与 `payload` 形状的对应关系由类型守卫，消费方按 `type` 收窄即得类型化 payload，不做强转。
- 渲染层通过单一监听器接收，再按 `sessionId` 路由到对应 `fileUuid` 的会话状态。

### StreamStep（步骤发射词表）

- 主进程可经 `step` 事件发出的步骤值集合：`generating-map`、`reading-doc`、`extracting`、`merging`、`finalizing`。
- 定义在共享契约 `ipc.ts`；主进程 emits 与渲染层消费同一份词表，两侧由编译器同时看守。
- 渲染层 `AiPipelineStep` 是其超集：`StreamStep` 之外还有 `idle`、`chatting`、`preparing` 等纯渲染层状态，不属于发射词表。

## 渲染层状态

### FileChatState

- 每个 `fileUuid` 独立的聊天状态，是聊天状态的**唯一事实源**。
- 包含：`activeSessionId`、`chatMessages`、`sessions`、`busy`、`step`、`streamText`、`errorMessage`、`activeTools`、`stopRequested`、`lastUserMessageAt`。
- `stopRequested` 为流停止标记（`markStreamStopping` 置位，`end`/`error` 复位）；`lastUserMessageAt` 为最近一次用户输入时间，二者是胶囊投影的事实源。
- 所有流相关状态都按文件隔离，确保文件 A 生成时切换到文件 B 不会互相干扰。
- store 顶层**不存在**这组字段的镜像副本；组件经只读 selector 投影读取当前文件的 `FileChatState`，写入只打到 `fileChats`。

### 当前聊天投影（Current Chat Projection）

- 渲染层读取"当前文件聊天状态"的唯一通道：按字段的只读 selector，把 `fileChats[currentFileUuid]` 的某个标量字段投影给组件。
- 缺省值（`busy ?? false`、`step ?? 'idle'` 等）收在 selector 内部，组件不感知。
- 无 `currentFileUuid` 时投影返回缺省值；写侧 action 在此情形一律 no-op。
- `activeStreamId` 不投影：它只是 `fileChats[currentFileUuid].activeSessionId` 与 `activeStreamIds` 的连接，仅由 store 内部的停止逻辑按需计算。

### AiStore 订阅

- `aiStore` 在创建时订阅 `mindmapRegistry` 的活动文件变化。
- 切换当前文件时自动更新 `currentFileUuid` 与 `currentFilePath`。

### 流事件路由

- `aiStore` 在创建时注册单一 `onStreamEvent` 监听器。
- 维护 `sessionId -> fileUuid` 映射与 `activeStreamIds: Record<sessionId, streamId>`。
- 收到事件时先通过 `sessionId` 找到 `fileUuid`，再校验 `streamId` 是否仍有效；无效则丢弃。
- `end`/`error` 事件后从 `activeStreamIds` 中移除对应条目。
- 注册前到达事件的缓冲与配对冲刷见「发送握手」。

### 发送握手（Send Handshake）

- 发起一次流式对话的固定时序，由 aiStore 的 `sendChatMessage` action 唯一拥有，组件不参与。
- 顺序即正确性：先 `await chatStream` 拿到 `streamId`，再以发起方身份调用 `registerStream(fileUuid, sessionId, streamId)`；两步不可对调、不可由不同模块分担。
- invoke 未 resolve 期间到达的流事件进入 pending-event buffer（按 `sessionId` 暂存）；`registerStream` 注册映射后配对冲刷，只放行 `streamId` 匹配的事件。
- 握手全程以发起前捕获的 origin ids（`fileUuid` / `sessionId`）为准，不用切换文件后的当前投影。
- 握手与 buffer 住在同一 module（`aiStore.ts`），时序由单元测试固定。

### 会话 API

- `listSessions({ workspacePath, fileUuid })` 只返回指定文件的会话列表。
- `loadSession({ workspacePath, sessionId })` 保持，返回该会话的消息。
- `deleteSession({ workspacePath, sessionId })` 保持，删除后清理 `activeSessionIds` 映射。
- `saveSession` 删除：runner 在流中自动持久化消息，前端不再手动保存。

### ChatContext

- 传给 `chatStream` 的上下文对象，包含 `fileUuid`、`filePath`、`fileTitle`、`workspacePath`、选中的节点、附件等。
- `fileUuid` 由前端提供，供 `Runner` 写入 `SessionMeta` 与执行 memory 提取。

### ChatCapsuleBar 状态

- 最近对话文件列表的**读时投影**，由 `deriveChatCapsuleEntries` 从 `fileChats` + `filePaths` + `currentFileUuid` 派生，不是独立维护的镜像。
- 每个条目包含：`fileUuid`、`fileName`（来自 `filePaths` 的路径基名）、`status`、最近一次用户输入时间 `lastInputAt`。
- `status` 派生：`stopRequested` → `stopping`；`busy` → `generating`；否则 `idle`。
- 成员判定：`lastUserMessageAt > 0`，或流进行中，或是当前文件。
- 当前 `fileUuid` 的条目排在首位并放大显示，其余按 `lastInputAt` 降序。

### Mindmap Tool Call Router

- 全局工具调用路由器，负责把流结束时的 mindmap action tool calls 与 `mindmapData` 应用到正确的文件 editor。
- 通过 `sessionId` 找到 `fileUuid`，再通过 `mindmapRegistry.getByFileUuid(fileUuid)` 拿到对应 `MindmapEditor`。
- 流式 UI 状态（`streamText`、`activeTools`）由组件直接按字段 selector 读取，不再经 `useChatStream` 包装层（该 wrapper 已随删除 pass 移除）。

### loadFileChat

- `aiStore` action，在切换当前文件时被调用。
- 根据 `fileUuid` 从 workspace `state.json` 的 `activeSessionIds` 恢复 `activeSessionId`。
- 若找不到或会话已被删除，则新建对话。
- 当没有打开文件时，清空聊天状态并显示提示。

## workspace 切换

### workspace 现场（Workspace Scene）

- 应用当前 workspace 的会话状态到前端 store，并清空上一 workspace 的文件现场。
- open / create / switch 三个入口在 IPC 成功后收敛到同一条恢复路径；入口间只保留各自 IPC 调用与错误语义差异。
- 切换后文件列表由恢复路径现取，IPC 响应的 `files` 字段已废弃移除。
- 展开状态不跨 workspace 保留：`expandedFolderPaths` 随树形 UI 移除，恢复路径不再读写该字段。
- _Avoid_: switchWorkspaceSession（"switch"只描述其中一个入口，open/create 同样走此路径）

## 文件保存

### 保存协议（Save Protocol）

- 所有 mindmap 保存路径共享的唯一保存流程，由 `saveMindmapInstance` 拥有：dirty-check → 守卫快照 → serialize → IPC save → 条件 markClean → `syncAfterFileSaved`。
- 只覆盖**保存到已知 filePath** 的情形；`filePath` 为 null 时的分支不属于协议，留在调用方：交互保存走另存为对话框，关窗前保存走 workspace 内静默创建，AI 后台保存直接报错。
- `syncAfterFileSaved` 由调用方注入，`saveMindmapInstance` 不依赖 workspace UI store。
- dirty-check 内置：干净文档的保存是 no-op，不重写文件、不重新生成 thumbnail。

### 保存守卫（Save Guard）

- 保存协议内置的竞态防护：在 `toMindLaneFile()` 序列化前捕获 `nodes` / `edges` / `documentRefs` 的引用，IPC 保存完成后重新读取实例状态做引用相等比较，三者均未变才 `markClean`。
- 比较字段与 `dirty` 的覆盖范围一一对应：`dirty` 只由 `setNodes` / `setEdges` / `addDocumentRef` 置位；`viewport` 与 `fileTitle` 不置 dirty，也不在守卫范围内。
- 守卫失败即保持 dirty、**不重试**：交互保存路径靠 autosave 兜底，窗口关闭路径接受丢失竞态窗口（毫秒级）内的编辑。
- 不存在无守卫的保存路径。

## 文件生命周期与聊天状态

### rename / move

- `fileUuid` 不变，`aiStore` 更新 `currentFilePath` 与 `chatFileCapsules` 中的文件名。
- `activeSessionIds` 以 `fileUuid` 为 key，无需改动。

### copy / saveAs

- 新文件生成新 `fileUuid`。
- 不继承原文件的会话历史，`aiStore` 中视为全新文件。

### delete

- `aiStore.currentFileUuid` 变为 `null`，聊天面板回到无文件状态。
- 从 `activeSessionIds` 中移除该 `fileUuid` 条目。
- 不删除底层会话数据。

## MCP 集成

### MCP catalog

- 应用内置的 MCP server 目录，作为代码资产随应用发版，不由用户编辑。
- 每个条目是一个 server 定义：`id`、显示名、icon、transport 类型、连接配置、授权工厂。
- 新增 MCP server = 在 catalog 中新增一个定义文件，不改其他代码。

### MCP 用户态

- 用户在 MCP 上的全部持久化状态，仅存于 `settings.json`。
- 每个 server 只有连接状态与非敏感展示信息（如 workspace 名）；**不含**任何 JSON 格式的连接配置。
- OAuth token、DCR client 凭据等敏感数据不属于用户态，经 `safeStorage` 加密后单独存放。

### MCP 可选开关

- 用户启用/停用某个 MCP server 的唯一方式：设置面板中的"连接 / 断开"操作。
- "连接"触发该 server 的授权流程（如 OAuth 浏览器授权）；"断开"删除凭据并移除其工具。
- 不存在独立于授权状态的 enabled 布尔开关。

### MCP 工具前缀

- 所有 MCP 工具注册进 `ToolRegistry` 时统一加 server 名前缀（如 `notion__API-post-search`）。
- 保证多 server 工具名永不冲突，并让模型与 UI 能识别工具来源。

## 文档导入管线

### Loader（加载器）

- 把一种输入源（PDF、DOCX、PPTX、XLSX、Markdown 文件、URL、文本）解析为一组 LangChain `Document` 的组件。
- PDF 使用 `pdf-parse` 按页提取文本，URL 使用原生 `fetch` 与 `cheerio` 提取网页正文；Office 三种格式共用一个按来源类型配置的 `officeparser` loader；Markdown 直接读取 UTF-8 文本。
- 每种输入源类型都在 loader registry 中注册，输出统一为 `Document[]`。PDF 每页一个，页码在 `metadata.loc.pageNumber`；PPTX 按 slide、XLSX 按 sheet、DOCX 按 paragraph 边界输出，位置 metadata 由 loader 透传。

### Chunk（切块）

- 一个 `Document` 经 splitter 切割后的文本片段，本身仍是 LangChain `Document`。
- 由 `RecursiveCharacterTextSplitter` 产出，目标约 2000 字符，无 overlap。
- _Avoid_: DocumentChunk（已删除的旧类型，含死字段 startPage/endPage）

### Batch（leaf 批次）

- 累加器把若干 chunk 贪心组合而成的单元，作为一次 leaf agent 调用的输入。
- 批次在 load 节点一次性预计算，leaf 循环只按批次下标推进。
- _Avoid_: pendingLeafRange、leaf range

### 累加器（Batcher）

- 按上下文预算把 chunk 序列组合成 batch 序列的纯函数。
- 单个 chunk 超过预算时独占一个 batch（允许超限），不切割 chunk。

### 上下文预算（Context Budget）

- 单个 batch 允许容纳的最大文本量 = 当前模型 `contextWindow` × 40%，以 2 字符 ≈ 1 token 折算为字符数。
- `contextWindow` 来自 provider 目录中的模型条目（`ModelOption`），未填写时回退 32k。
- 40% 是刻意保留的裕量，同时覆盖 prompt 模板与模型输出开销，不做精确 token 计数。

### Leaf 提取（Leaf Extraction）

- 对一个 batch 调用聊天模型、产出一棵 YAML 结构树的过程，是导图生成的最小工作单元。
- 多个 leaf 之间**无依赖、可并行**；结果按 `batchIndex` 排序后进入归并，文档叙事顺序不因完成顺序乱序而改变。
- 单个 leaf 内部有 YAML 校验重试；重试耗尽即整轮 fail-fast，不存在"跳过失败 batch 继续生成"的降级路径。

### Wave（波）

- 导图生成并发调度的唯一机制：路由函数一次发出 ≤ 并发上限（当前为 4）个 `Send` 并行分支，super-step 屏障收齐结果后再发下一波。
- 并发上限只由波宽控制，代码中不存在无上限的并行 fan-out，也不存在手写 semaphore。
- 每个分支是 graph 中的独立节点调用，为未来 leaf 粒度 checkpoint/resume 保留结构兼容（resume 本身当前是范围外）。

### 归并轮次（Merge Round）

- 全部 leaf 完成后，把树按 8 棵一组分组、按 wave 机制并行合并的一轮；若一轮产出多棵树，则以产出为输入进入下一轮，直到收敛为单棵 `finalTree`。
- 两阶段 map-reduce 的 reduce 阶段：leaf 全部完成前**不做**任何穿插式合并（旧的"攒够 8 棵就提前 merge"设计已废弃）。
- 单个 leaf 的文档跳过整个归并阶段，其结果直接成为 `finalTree`。

## AI Provider

### Provider 解析（Provider Resolution）

- 从 settings 得到可用 chat provider 的唯一配方，由主进程 `resolveChatProvider` 拥有；其余调用点不得自行拼装。
- provider 配置的唯一来源是 settings；不存在请求级的 apiKey/model override。
- 缺 API Key、chatModel 为空或失效时直接抛错，**不做任何静默兜底**——应用代码中不存在默认模型。

### chatModel 空态

- `chatModel` 记录用户的**显式选择**；空串 `''` 表示"未选择"，不指向任何模型。
- 模型的合法集合由当前 provider 的目录（`defaultModels`）定义；`qwen-turbo` 等具体型号只是目录中的普通一项，无特殊地位。
- 切换 provider 时 `chatModel` 重置为空，强制用户重新选择。

### 对话就绪（Chat Ready）

- 前端允许发起对话的前提：settings 已加载、当前 provider 已填 API Key、已显式选择模型，三者同时成立。
- 未就绪时 `ChatInputBar` 禁用并在 placeholder 提示缺失项；palace 生成入口复用同一判定。
- 主进程解析时的抛错是最后一道防线，渲染层门控不替代它。

### 模型（Model）

- provider 暴露的**单一聊天模型**实例（基类字段 `model`）；模型层不区分"聊天模型/推理模型"档位——旧 `reasoningModel` 与 `chatModel` 别名是同一实例的重复命名，已收敛。
- 记忆提取、会话摘要、导图生成等所有模型调用共用它；不同任务的成本差异由模型自身能力或请求参数（如 DeepSeek 的思考模式开关）表达，不靠第二个模型实例。

### ModelOption

- provider 目录中的单个模型条目：`id`（调用名）、`displayName`（展示名）、`contextWindow?`（上下文窗口，未声明回退 32k）。
- 目录与 provider 能力是**单一声明源**：provider 类静态声明 `id`/`displayName`/`capabilities`/`defaultModels`，registry 注册与设置面板都从这里读，不存在第二份副本。

### Provider 能力（Capability）

- provider 自声明的能力集合：`chat`（对话）、`vision`（视觉理解）、`imageGen`（文生图）。
- 记忆宫殿功能要求 chat provider 同时具备 `vision` + `imageGen`；不具备时（如 Kimi Code、MiniMax、DeepSeek）入口返回友好错误，不降级尝试。
- 视觉与文生图**未设独立 provider 槽位**：`activeProviders.image` 仅存在于 settings 形状中，主进程始终使用 chat provider 承载 palace 子图（已知遗留，见 ADR-0014 附注）。

## 日志

### 日志上下文（Log Context）

- 每条日志携带的层级化标识，格式为 `模块名:streamId短前缀`，如 `mindmapGraph:a1b2c3d4`。
- 用于把一次运行中跨图、跨模块的日志关联到一起。
- 日志中一次运行的身份统一使用 `streamId`，不存在独立的 `runId` 概念。

### 排障日志（Diagnostic Log）

- 日志的第一读者是开发者与用户排障场景，不是程序自身。
- 持久化到 `userData` 下的日志文件，文件不出本机；发送给开发者是用户的显式动作。
- 文件内记录包含 debug 级别（含完整 prompt 等详细内容），console 仅 info 及以上。

### 计量日志（Metering Log）

- 每次模型调用固定输出的一行 info 日志：模型名、耗时、token 输入/输出。
- provider 不返回 token 用量时对应字段打 `?`，不因数据缺失放弃该 provider 的可观测性。
- 与 compact 日志互相印证：compact 生效后下一次模型调用的输入 token 应下降。

## 记忆系统

### 思维模式记忆（Pattern Memory）

- 记忆系统目前唯一的记忆类型：用户的学科思维模式与偏好。
- 归属于 6 个固定学科分类（formal-sciences / natural-sciences / engineering / humanities / social-sciences / creative-arts），分类下挂 subTag。
- 消费方：聊天时按 `.mindlane` 文件的 tags 加载相关记忆，注入 system prompt 以适配用户思维风格。

### 记忆证据来源（Memory Evidence Source）

- 思维模式记忆的输入语料，目前有两个：
  1. **对话内容**：会话中的用户与 AI 消息。
  2. **节点编辑历史**：用户在前端对节点**文本内容**的编辑记录。属于"用户亲笔写的东西"，与对话同质；不含加节点、拖布局等结构性操作。

### 记忆提取时机

- 记忆提取**挂钩在会话压缩（consolidation）上**：`Consolidator` 压缩旧消息时，被压缩的消息切片即为提取输入，`lastConsolidated` 游标复用为提取游标。
- 从不触发压缩的会话不做提取——这是有意接受的盲区（短会话信号不足）；节点编辑历史随该会话的下一次压缩一起提取，不做独立兜底。
- 摘要 LLM 失败时不推进游标，提取随之下轮顺延，证据不丢。

### subTag

- 思维模式记忆在学科分类下的细分标签，kebab-case，一个 subTag 对应记忆目录下的一个 `.md` 文件。
- 开放词表但**复用优先**：提取时把现有 subTag 清单喂给 LLM，只有现有 tag 均不匹配时才允许新建。
- 提取使用 chatModel（非 reasoningModel）。

### 工作区内文档（Workspace Document）

- 归属于某个 workspace 的 `.mindlane` 文件，「文件属于哪个 workspace」以**加载/保存时的归属**为准，不以读取时的全局 workspace 为准。
- workspace 内打开（open / 恢复 / 新建 / 静默创建）时记录 workspacePath；`file.open` 打开的 workspace 外独立文件不记录。
- 另存为成功后同样按新位置更新归属，不等待重开。
- 归属是「节点编辑历史是工作区内文档的证据」这一领域含义的前提：非工作区内文档的手动编辑不进入 editlog。

### 节点编辑历史（Node Edit Log）

- 按 `fileUuid` 存储的 append-only JSONL：`memory/editlog/{workspaceUuid}/{fileUuid}.jsonl`。
- 只在用户**手动提交文本编辑**时记录一条 `{ts, nodeId, before, after}`；`before` 必存（改动前后的对比是思维模式的最强证据）。
- AI 对节点文本的修改**不记录**——不是用户的思维证据。
- 环形封顶 200 条，超出丢最旧（防止永不压缩的会话无限累积）。
- 提取时被拼入提取 prompt，提取成功后删除该文件。

## 进程边界（Seam）

### 桥（Bridge）

- 渲染层访问主进程能力的**唯一门户**：`window.mindlane`，按命名空间组织（ai / file / workspace / chat / settings / window / shell / editlog）。
- 类型由契约模块 `ipc.ts` 的 `MindlaneBridge` 声明，preload 实现与渲染层引用同一份，编译器看守。
- 类型上为必选（`mindlane: MindlaneBridge`），渲染层现有 `?.` 访问是运行时防御，不代表桥可能缺失。
- _Avoid_: ipcRenderer、window.ipcRenderer

### Handler 模块（Handler Module）

- 主进程侧按领域服务归组的 IPC handler 注册单元，是桥在主进程一侧的应答实现。
- 每个模块只委托一个领域模块；分组遵循"一个领域服务对应一个模块"：file+workspace 归 `fs`、ai+editlog 归 `ai`、chat 归 `chat`、settings 归 `settings`、mcp 归 `mcp`、shell 归 `shell`、window 归 `window`。
- 由 bootstrap（启动编排）唯一装配，模块内部不构造任何服务。

### 装配（Assembly）

- 主进程启动时一次性实例化并接线领域服务的动作：agent 侧服务（sessionManager / checkpointer / memoryManager / memoryExtractor / editLogStore）由装配函数创建并完成交叉接线（sessionManager ↔ checkpointer），随后由启动编排（bootstrap）按消费方所需分发。
- 消费方（handler 模块、streamManager、orchestrator）只接收已装配的服务或窄接口，从不自行构造服务。
- 装配点本身允许很浅：它的职责就是实例化与接线，"没有行为"不是缺陷；缺陷是把装配点当作服务传给无关消费方，让新增一个存储波及所有消费方。
- _Avoid_: 服务袋（Service Bag）——把全部服务打包后整个传给每个消费方，消费方往里掏字段（历史形态：AiService）。

### AI 服务就绪（AI Service Readiness）

- AI 功能（聊天、记忆、编辑历史）可用的前提：agent 侧服务装配（见「装配」）成功。
- 装配失败时应用**降级而非失败**：导图编辑不受影响，聊天入口禁用并明确提示（启动弹窗 + 红色禁用态）。
- 与「对话就绪」独立：对话就绪是 provider 配置层面的门控（设置已加载、API Key 已填、模型已选）；AI 服务就绪是主进程服务装配层面的门控（装配函数成功）。两者任一不满足都禁用聊天，原因不同。

### 旁路（Bypass）

- 渲染层绕过桥、直接调用主进程能力的通道（历史上曾暴露原始 `ipcRenderer`，可 invoke 任意 channel）。
- 当前代码中**不存在，也不允许存在**；渲染层不得出现任何对 `electron` 的直接 import。
- 防复发：显式 `contextIsolation`/`sandbox`/`nodeIntegration` 配置 + 编译期 `MindlaneBridge` 守卫 + grep 断言（渲染层 `ipcRenderer` 引用数 = 0）。

### IpcResult

- 跨进程边界的结果信封：`{ ok: true; data: T } | { ok: false; error: string }`。
- 用于所有**可失败**的桥接方法；**必然成功**的读取（如最近文件列表、workspace 会话、设置）直接裸返回，不包信封。
- 定义在契约模块 `ipc.ts`，主进程 fs 服务经 re-export 复用同一类型。
- _Avoid_: FsResult（旧名，误导性地暗示仅文件系统用途，实际覆盖 ai / mcp / settings 等所有跨界调用）

## 本次范围外

### MemoryExtractor

- 本次迭代保持使用 `filePath`。
- `MemoryManager` 的 memory 文件仍是全局存储，未按 `fileUuid` 拆分；该重构留到后续统一处理。
