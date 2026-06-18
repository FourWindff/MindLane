# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MindLane is an Electron desktop app for interactive mindmapping with AI assistance. It combines a React-based visual mindmap editor (built on `@xyflow/react`) with a LangGraph-powered multi-agent AI system that runs in the Electron main process.

## Development Commands

```bash
# Start dev server (Vite + Electron)
npm run dev

# Build for production (TypeScript compile + Vite build + electron-builder)
npm run build

# Run linter
npm run lint

# Run all tests (Vitest, sequential due to memory constraints)
npm run test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest run src/shared/lib/__test__/yamlMindmapParser.test.ts
npx vitest run electron/agent/__test__/orchestrator.test.ts
```

Tests run in Node environment (not jsdom). The vitest config sets `pool: 'forks'`, `fileParallelism: false`, `maxWorkers: 1` to avoid memory issues with large PDF parsing and native module loading.

## Architecture

### Process Split

- **Renderer process** (`src/`): React 18 + Vite. Handles UI, mindmap visualization, chat panel, workspace file tree.
- **Main process** (`electron/`): Node.js + Electron. Handles file I/O, AI orchestration, SQLite persistence, native APIs.
- **IPC bridge** (`electron/preload.ts`): Exposes `window.mindlane` API to renderer. All renderer-to-main communication goes through typed IPC channels (e.g., `ai:chat-stream`, `file:save`, `workspace:list-files`).

### Frontend (`src/`)

**State management** uses Zustand with feature-based stores:
- `useMindmapStore` (`features/mindmap/model/mindmapStore.ts`) — nodes, edges, dirty state, file path. Integrates with `@xyflow/react` via `applyNodeChanges`/`applyEdgeChanges`.
- `useWorkspaceStore` (`features/workspace/store.ts`) — workspace directory, file tree, recent files.
- `useAiStore` (`features/chat/model/aiStore.ts`) — chat state, streaming text, sessions.
- `useSettingsStore` (`features/settings/model/settingsStore.ts`) — app settings persisted to backend.

**Mindmap rendering** uses `@xyflow/react` (React Flow). Nodes are registered via a `NodeRegistry` (`features/mindmap/nodes/registry.ts`) that maps `typeId` to React components. Current node types:
- `text` — standard mindmap node
- `palace` — memory palace node with stations and generated imagery

Node type descriptors implement `serialize()`/`deserialize()` for persistence. Auto-layout uses a custom DAG-based algorithm (`shared/lib/autoLayout.ts`) with left-to-right tree positioning.

**Shortcuts** are managed by a centralized `ShortcutRegistry` (`shared/shortcuts/`) with context-aware registration via `useShortcut()` hook. Combos use `mod` (Cmd on macOS, Ctrl elsewhere).

### Backend (`electron/`)

**AI system** (`electron/agent/`) is built on LangGraph (`@langchain/langgraph`):
- `orchestrator.ts` — Main entry point. Routes chat requests through a state graph with tool-calling LLM agents.
- `agenthub/` — Specialized agents: `analyzeAgent`, `anchorAgent`, `imageGenAgent`, `mindlaneAgent`. Each agent is a prompt + LLM call with structured output.
- `graphs/` — LangGraph state graphs: `mindmapGraph/index.ts` (mindmap generation/editing), `palaceGraph.ts` (memory palace creation pipeline).
- `tools/` — Tool definitions exposed to agents: `mindmapActions.ts` (add/delete/rename nodes), `mindmapContext.ts` (read current mindmap state), `linkedDocumentSearch.ts` (search linked document text), `subgraphRoutingTools.ts` (virtual subgraph routing), and `toolResultNormalizer.ts` (tool-result cleanup/offloading).
- `providers/` — Pluggable LLM provider system. Currently supports DashScope, MiniMax, Kimi. Each provider implements chat, streaming, and optional image generation. Registry in `providers/registry.ts`.
- `memory/contextCompact.ts` — In-memory token-budget compaction; trims or summarizes messages when the prompt is still over budget after archival.
- `context/sessionManager.ts` — Multi-session chat history stored as JSONL (`session.jsonl`) via `SessionMessageStore`.
- `context/consolidator.ts` — Persistent session-history consolidation: archives old messages to `{sessionId}.history.jsonl`, tracks a `lastConsolidated` cursor and `_lastSummary`, and feeds the most recent unarchived messages into the LLM context.

**File system** (`electron/fs/`):
- `FileSystemService` (`fs/index.ts`) coordinates file operations.
- `projectFileManager.ts` — `.mindlane` file load/save.
- `workspaceManager.ts` — Directory listing, tree traversal, CRUD on workspace items.
- `settingsManager.ts` — JSON settings persisted in Electron's `userData`.
- `recentFilesManager.ts` — Recently opened files with thumbnails.

## Context Compaction and Session Archival

Long conversations are managed in two layers:

1. **Persistent archival** — Before each supervisor call, the `contextCompact` node runs `Consolidator.maybe_consolidate_by_tokens()`. It reads `session.jsonl`, and when the unarchived messages exceed the configured count/token budget it compresses the oldest messages into `{sessionId}.history.jsonl`. The archive cursor `lastConsolidated` and the latest summary `_lastSummary` are stored in `SessionMeta`.
2. **Recent-context retrieval** — `Consolidator.getMessagesForContext()` returns up to `maxContextMessages` unarchived messages, trimmed by token budget while always preserving system messages and the current user message.
3. **Memory-level fallback** — `memory/contextCompact.ts` still performs a lightweight in-memory trim or LLM summary if the retrieved context is still over budget.

The latest `_lastSummary` is injected into the system prompt by `ContextBuilder.withLastSummary()`, so the model retains a high-level view of earlier conversation even after the raw messages have been archived.

### File Format

`.mindlane` files are JSON with this structure:
```
{
  version: '1.0',
  metadata: { title, createdAt, updatedAt },
  mindmap: { nodes: [...], edges: [...], viewport: { x, y, zoom } },
  documents: [] // linked document metadata
}
```

Nodes are stored with serialized `data` fields (type-specific). On load, `nodeRegistry.get(type).deserialize()` rehydrates them. YAML import/export is supported via `yamlMindmapParser.ts`.

## Key Conventions

- Path alias `@/` maps to `src/`. Electron code uses relative imports or `../../src/...` for shared types.
- Electron main entry: `electron/main.ts`. Preload: `electron/preload.ts`.
- `electron-builder.json5` configures packaging. Native modules (`better-sqlite3`, `pdf-parse`) are marked external in `vite.config.ts`; `better-sqlite3` is included in `asarUnpack`.
- DevTools toggle: F12 or Ctrl/Cmd+Shift+I.
- Window is frameless; custom title bar in `AppWindowBar.tsx` with minimize/maximize/close via IPC.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **MindLane** (3653 symbols, 7684 relationships, 267 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/MindLane/context` | Codebase overview, check index freshness |
| `gitnexus://repo/MindLane/clusters` | All functional areas |
| `gitnexus://repo/MindLane/processes` | All execution flows |
| `gitnexus://repo/MindLane/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
