# MindLane

MindLane is an Electron desktop app for interactive mindmapping with AI assistance. The renderer is a React/Vite app built around `@xyflow/react`; the Electron main process owns file I/O, provider setup, LangGraph orchestration, session history, memory extraction, and native persistence.

## Commands

```bash
npm run dev        # Vite + Electron dev server
npm run build      # TypeScript, Vite build, electron-builder
npm run lint       # ESLint
npm run test       # Vitest via the Electron runtime wrapper
npm run test:watch # Vitest watch mode
```

## Project Shape

- `src/app` contains the app shell and renderer entry point.
- `src/features/mindmap` contains the React Flow canvas, node registry, custom node components, edge rendering, and mindmap state.
- `src/features/chat` contains the floating chat panel, streaming hooks, and chat session store.
- `src/features/workspace` contains workspace state, file tree UI, and file manager UI.
- `src/features/settings` contains provider/settings UI and persisted settings state.
- `src/shared` contains renderer-shared helpers such as file format parsing, YAML mindmap parsing, layout, and shortcut registration.
- `electron/main.ts` wires Electron windows and IPC.
- `electron/preload.ts` exposes the typed `window.mindlane` bridge.
- `electron/fs` contains workspace, `.mindlane`, settings, thumbnails, cache, and recent-file persistence.
- `electron/agent` contains LangGraph graphs, provider adapters, tools, message/session context handling, memory, and orchestration.

## Notes

- `.mindlane` files are JSON documents with metadata, mindmap nodes/edges/viewport, and linked document metadata.
- Chat UI history is persisted per session as JSONL through `SessionManager` / `SessionMessageStore`.
- Long agent contexts are managed by persistent consolidation plus in-memory token-budget compaction.
- `better-sqlite3` and `pdf-parse` are externalized for Electron packaging; `better-sqlite3` is unpacked from ASAR.
