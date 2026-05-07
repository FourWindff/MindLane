# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — 启动 Vite + Electron 开发模式（`vite-plugin-electron/simple` 同时编译 main/preload 并在渲染进程加载 React）
- `npm run build` — `tsc` 类型检查 → `vite build` → `electron-builder` 打安装包
- `npm run lint` — ESLint（`--max-warnings 0`，警告即失败）
- `npm test` — Vitest 单跑（已设 `--max-old-space-size=4096`，因 PDF/RAG 测试吃内存）
- `npm run test:watch` — Vitest 监听模式
- 单测过滤：`npm test -- <文件子串>` 或 `npm test -- -t "<用例名>"`

测试发现规则（见 `vitest.config.ts`）：只匹配 `electron/**/__test__/**/*.test.ts` 和 `src/**/__test__/**/*.test.ts`，强制串行（`fileParallelism: false`、`maxWorkers: 1`）以避免 PDF 解析与 hnswlib 索引并发时 OOM。新测试必须放在 `__test__/` 子目录下。

## Architecture

**Electron 双进程 + LangGraph Agent + RAG 桌面应用**。整体分三层：

### 1. 进程模型与 IPC

- **主进程**（`electron/main.ts`）持有所有"特权能力"：文件系统、SQLite、向量库、LLM 提供商。通过 `ipcMain.handle(...)` 暴露能力。
- **预加载脚本**（`electron/preload.ts`）只透传 `ipcRenderer` 的 4 个方法到渲染进程的 `window.ipcRenderer`，渲染进程不直接持有 Node 能力。
- **渲染进程**（`src/`）是 React 18 + Zustand + @xyflow/react，通过 `window.ipcRenderer.invoke(...)` 调主进程。
- 添加新能力的标准动线：`electron/main.ts` 注册 IPC handler → `electron/preload.ts` 中类型声明（如有）→ `src/` 调用方写 invoke → `src/shared/types/` 共享类型定义。

### 2. Agent 层（`electron/agent/`）

基于 **LangChain + LangGraph** 构建，是这个项目的核心复杂度所在：

- `orchestrator.ts` — 顶层 `StateGraph`，根据请求路由到子图。`ChatRequest` 只传 `threadId + message + context`，**历史由后端 `SessionManager`/`MemorySaver` 保管**，渲染端不要往请求里塞历史消息。
- `graphs/mindmapGraph.ts`、`graphs/palaceGraph.ts` — 两个核心子图（思维导图生成 / 记忆宫殿 HITL 流程）。`palaceGraph` 会抛 `HITLInterruptError` 用于人在环路中断，主进程需通过 `Command(resume=...)` 续跑。
- `agenthub/` — 具体 agent 实现（`analyzeAgent`、`anchorAgent`、`imageGenAgent`、`mindlane/mindlaneAgent`），各自有提示词在 `agenthub/prompts/`。
- `tools/` — LangChain `StructuredTool`，最重要的是 `mindmapActions.ts`（agent 操作思维导图节点的工具集）和 `mindmapContext.ts`（把当前 mindmap 状态注入提示词的上下文构建器）。
- `providers/` — LLM 提供商抽象（OpenAI / Anthropic / 自定义），用 `ProviderCapability` 标记能力（视觉、工具调用等），`createProvider` 是工厂入口。
- `rag/` — 完整 RAG 子系统：`indexer` 索引 / `retrieval` 检索 / `storage` 持久化（`better-sqlite3` + `hnswlib-node`）/ `prepare` 文档预处理（PDF 走 `pdf-parse`、Word 走 `mammoth`）。`manager.ts` 是单例入口。
- `memory/`、`context/sessionManager.ts` — 会话与长期记忆，使用 `@langchain/langgraph-checkpoint-sqlite` 做 checkpoint 持久化。
- `service.ts` (`AiService`) — 把上面所有东西组装起来供 `main.ts` 注入到 `AgentOrchestrator`。

### 3. 渲染端（`src/`）

按 **feature-sliced** 组织，不是按技术分层：

- `src/app/` — 应用入口、根组件、全局样式
- `src/features/{mindmap,chat,knowledge-base,review,settings,shell,workspace}/` — 每个 feature 自带 `components/` + `model/`（Zustand store），`mindmap` 还多一层 `nodes/` 放各种 xyflow 自定义节点
- `src/shared/lib/fileFormat.ts` — `MindLaneFile` / `MindLaneNode` / `MindLaneEdge` 类型定义，**主进程和渲染进程都引用这一份**，是跨进程数据契约的事实源
- `src/shared/{shortcuts,types}/` — 全局快捷键和共享类型
- 路径别名：`@/` → `src/`（在 `vite.config.ts` 和 `vitest.config.ts` 都配了）

### 4. Vite Electron 构建关键点

`vite.config.ts` 中主进程的 rollup `external` 函数把 **原生模块和大型不友好包** 排除出 bundle：`better-sqlite3`、`hnswlib-node`、`pdf-parse`、`mammoth`、`@anthropic-ai/sdk`、所有 `node:` 内置和 `electron`。**新增原生依赖或运行时报 "Cannot find module"，第一站检查这个 external 列表**。`renderer` 配置在测试模式（`NODE_ENV === 'test'`）下被禁用，避免与 vitest 冲突。

### 5. OpenSpec 工作流

项目使用 OpenSpec（`openspec/`）做 spec-driven changes。`openspec/config.yaml` 要求**用中文写所有文档**。变更提案在 `openspec/changes/`、规格在 `openspec/specs/`，由 `openspec-*` / `opsx:*` skills 驱动。

## Conventions

- 用户面向交流和文档统一**中文**（含 OpenSpec、提交信息倾向）。代码标识符保留英文。
- 绝不要把 `node:*`、`electron`、原生模块导入渲染端代码——通过 IPC 调用主进程。
- 跨进程的数据结构改动（`MindLaneFile` 等）必须同步检查主进程序列化和渲染端反序列化两侧。

## 测试与验证

- **Electron MCP 优先**：本项目已配置 `mcp__electron_*` 工具集（基于 Chrome DevTools Protocol），用于与运行中的 Electron 应用交互（截图、获取页面结构、执行 JS、发送键盘快捷键等）。
- **禁止在 Electron 测试场景中使用 Playwright**：当需要与 Electron 应用 UI 交互、验证渲染进程行为或进行端到端验证时，必须使用 `mcp__electron_*` 工具，不得使用 `mcp__plugin_playwright_playwright__*` 工具。Playwright 的 Electron 支持与本项目的 `vite-plugin-electron/simple` 开发模式存在兼容性问题。
- **主进程逻辑使用 Vitest**：纯主进程逻辑（`electron/agent/`、`electron/rag/` 等）继续使用 `npm test` 运行单元测试。
- **验证流程**：
  1. 启动应用：`npm run dev`
  2. 使用 `mcp__electron__get_electron_window_info` 确认应用已连接
  3. 使用 `mcp__electron__send_command_to_electron` 执行交互（`get_page_structure`、`click_by_text`、`fill_input` 等）
  4. 使用 `mcp__electron__take_screenshot` 验证 UI 状态
