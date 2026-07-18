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

### ChatStreamEvent

- 统一的流事件 IPC 结构：`{ streamId, sessionId, type, payload }`。
- `type` 包括 `token`、`message-start`、`tool-start`、`tool-end`、`end`、`error`。
- 渲染层通过单一监听器接收，再按 `sessionId` 路由到对应 `fileUuid` 的会话状态。

## 渲染层状态

### FileChatState

- 每个 `fileUuid` 独立的聊天状态。
- 包含：`activeSessionId`、`chatMessages`、`sessions`、`busy`、`step`、`streamText`、`errorMessage`、`activeTools`。
- 所有流相关状态都按文件隔离，确保文件 A 生成时切换到文件 B 不会互相干扰。

### AiStore 订阅

- `aiStore` 在创建时订阅 `mindmapRegistry` 的活动文件变化。
- 切换当前文件时自动更新 `currentFileUuid` 与 `currentFilePath`。

### 流事件路由

- `aiStore` 在创建时注册单一 `onStreamEvent` 监听器。
- 维护 `sessionId -> fileUuid` 映射与 `activeStreamIds: Record<sessionId, streamId>`。
- 收到事件时先通过 `sessionId` 找到 `fileUuid`，再校验 `streamId` 是否仍有效；无效则丢弃。
- `end`/`error` 事件后从 `activeStreamIds` 中移除对应条目。

### 会话 API

- `listSessions({ workspacePath, fileUuid })` 只返回指定文件的会话列表。
- `loadSession({ workspacePath, sessionId })` 保持，返回该会话的消息。
- `deleteSession({ workspacePath, sessionId })` 保持，删除后清理 `activeSessionIds` 映射。
- `saveSession` 删除：runner 在流中自动持久化消息，前端不再手动保存。

### ChatContext

- 传给 `chatStream` 的上下文对象，包含 `fileUuid`、`filePath`、`fileTitle`、`workspacePath`、选中的节点、附件等。
- `fileUuid` 由前端提供，供 `Runner` 写入 `SessionMeta` 与执行 memory 提取。

### ChatCapsuleBar 状态

- 维护“最近对话过的文件”列表，key 为 `fileUuid`。
- 每个条目包含：`fileUuid`、`fileName`、`status`、最近一次用户输入时间 `lastInputAt`。
- 用户发送消息时更新 `lastInputAt`，并把该文件移到最前。
- 开始流时 `status` 为 `generating`；调用停止时改为 `stopping`；收到 `end`/`error` 后改为 `idle`。
- 当前 `fileUuid` 的条目不会被过滤，而是排在首位并放大显示。

### Mindmap Tool Call Router

- 全局工具调用路由器，负责把流结束时的 mindmap action tool calls 与 `mindmapData` 应用到正确的文件 editor。
- 通过 `sessionId` 找到 `fileUuid`，再通过 `mindmapRegistry.getByFileUuid(fileUuid)` 拿到对应 `MindmapEditor`。
- `useChatStream` 不再执行工具调用或 `insertMindmapData`，只负责当前文件的流式 UI。

### loadFileChat

- `aiStore` action，在切换当前文件时被调用。
- 根据 `fileUuid` 从 workspace `state.json` 的 `activeSessionIds` 恢复 `activeSessionId`。
- 若找不到或会话已被删除，则新建对话。
- 当没有打开文件时，清空聊天状态并显示提示。

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

- 把一种输入源（PDF 文件、URL、文本）解析为一组 LangChain `Document` 的组件。
- 优先使用 `@langchain/community` 的 loader（`PDFLoader`、`CheerioWebBaseLoader`）。
- 每种输入源对应一个 loader，输出统一为 `Document[]`（PDF 每页一个，页码在 `metadata.loc.pageNumber`）。

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
- `contextWindow` 来自 provider 的 `ChatModelOption`，未填写时回退 32k。
- 40% 是刻意保留的裕量，同时覆盖 prompt 模板与模型输出开销，不做精确 token 计数。

## 本次范围外

### MemoryExtractor

- 本次迭代保持使用 `filePath`。
- `MemoryManager` 的 memory 文件仍是全局存储，未按 `fileUuid` 拆分；该重构留到后续统一处理。
