# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- `npm run dev` — Start the Vite dev server and Electron app.
- `npm run build` — Run TypeScript type checking, Vite build, and electron-builder packaging.
- `npm run lint` — Run ESLint on `ts` / `tsx` files.
- `npm run test` — Run Vitest through the Electron runtime.
- `npm run test:watch` — Run Vitest in watch mode.
- `npm run test -- <path/to/test.ts>` — Run a single test file, e.g. `npm run test -- electron/agent/context/__test__/pipeline.test.ts`.
- `npm run preview` — Preview the Vite production build (renderer only).

Testing note: `better-sqlite3` is a native C++ module that must match the runtime Node ABI. `scripts/test.mjs` runs Vitest with `ELECTRON_RUN_AS_NODE=1` so Electron acts as the Node runtime. `npm run dev` will automatically rebuild the module for Electron's ABI if needed.

## Project Architecture

MindLane is an Electron desktop mind-mapping app. The renderer is a React + Vite app, and the main process handles file IO, AI provider setup, LangGraph orchestration, and persistence.

### Directory Responsibilities

- `src/app` — Renderer entry point (`main.tsx`, `App.tsx`) and app-level styles.
- `src/features/mindmap` — Mindmap canvas built on `@xyflow/react`, including the node registry (`text`, `palace`), custom edges, style panel, AI progress overlay, and state.
- `src/features/chat` — Floating chat panel, streaming messages, session list, and chat state.
- `src/features/workspace` — Workspace state, file tree UI, and file manager.
- `src/features/settings` — Settings modal/panel and persisted settings state.
- `src/features/shell` — App toolbar and custom window chrome.
- `src/shared` — Renderer-shared utilities: `.mindlane` file format parsing, YAML mindmap parsing, auto layout, and shortcut registration.
- `electron/main.ts` — Main process entry: creates windows, registers IPC handlers, and initializes `FileSystemService` and `AiService`.
- `electron/preload.ts` — Exposes the typed `window.mindlane` IPC bridge; this is the only way the renderer should access main-process capabilities.
- `electron/fs` — Workspace, `.mindlane` file, settings, thumbnail, cache, and recent-file persistence.
- `electron/agent` — LangGraph workflows, provider adapters, tools, message/session context, memory extraction, and orchestration.

### Cross-Process Communication

- The renderer calls main-process capabilities through `window.mindlane`; do not use raw `ipcRenderer` directly.
- AI streaming chat starts with an `ai:chat-stream` invoke; the main process emits identified events through the single `ai:chat-stream-event` channel.
- File, workspace, settings, chat session, and window-control APIs are exposed under `window.mindlane` sub-namespaces. Type definitions live in `electron/preload.ts`.

### State Management

- Renderer state is managed with Zustand. Key stores are:
  - `src/features/mindmap/model/mindmapStore.ts`
  - `src/features/mindmap/style/styleStore.ts`
  - `src/features/chat/model/aiStore.ts`
  - `src/features/settings/model/settingsStore.ts`
  - `src/features/workspace/store.ts`
- Main-process services (`FileSystemService`, `AiService`, `AgentOrchestrator`, `StreamManager`) are created as singletons in `electron/main.ts` and exposed via IPC.

### Agent and AI Orchestration

- `StreamManager` owns concurrent chat `Runner` lifecycles and identified stream events; its cached runtime comes from the main-owned `AgentOrchestrator` in `electron/agent/orchestrator.ts`, which compiles graphs and runs palace generation.
- `electron/agent/graphs/mindmapGraph` and `electron/agent/graphs/palaceGraph` are the LangGraph workflow entry points for mindmap and palace generation.
- `electron/agent/agenthub` contains specialized agents (analyze, anchor, imageGen, mindlane) and shared prompts.
- `electron/agent/context` manages session messages and context compaction/consolidation (consolidator, pipelineCompaction, pipelinePairing, pipelineSnip).
- `electron/agent/memory` handles long-term memory: memoryExtractor, memoryManager, and a SQLite-backed checkpointer.
- `electron/agent/providers` is the provider registry and middleware layer (abort, retry, timeout). Supported providers include Anthropic, OpenAI, Kimi Code, MiniMax, and DashScope.
- `electron/agent/tools` contains tool implementations: mindmapActions, mindmapContext, and subgraphRoutingTools.

### Data and Persistence

- `.mindlane` files are JSON documents containing `metadata`, `nodes`, `edges`, `viewport`, and `linkedDocuments`.
- Chat history is persisted per session as JSONL via `SessionManager` / `SessionMessageStore`.
- Workspace state (last opened file, expanded folders, etc.) is stored in hidden metadata inside the workspace directory.
- App settings are stored in `settings.json` in the user data directory.

## Build and Packaging Notes

- `better-sqlite3`, `pdf-parse`, and `@anthropic-ai/sdk` are externalized in `vite.config.ts`.
- `electron-builder.json5` includes `better-sqlite3` and `pdf-parse` in the packaged app and unpacks `better-sqlite3` from ASAR.
- The `@/*` path alias maps to `src/*` in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **MindLane** (5341 symbols, 11190 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource                                  | Use for                                  |
| ----------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/MindLane/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/MindLane/clusters`       | All functional areas                     |
| `gitnexus://repo/MindLane/processes`      | All execution flows                      |
| `gitnexus://repo/MindLane/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->

## Agent skills

### Issue tracker

Issues and PRDs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five canonical label strings unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read `CONTEXT.md` at the repo root and `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.
