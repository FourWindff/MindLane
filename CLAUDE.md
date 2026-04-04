# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MindLane is an Electron-based desktop application for AI-assisted mind mapping and knowledge management. It combines a React-based visual mind map editor (using React Flow) with LangChain/LangGraph-powered AI agents for generating memory palaces, document analysis, and interactive chat.

## Common Commands

```bash
# Development - starts Vite dev server with Electron
npm run dev

# Build for production (TypeScript compile + Vite build + Electron Builder)
npm run build

# Lint TypeScript/TSX files
npm run lint

# Preview production build locally
npm run preview
```

There are no test commands configured in this project.

## Architecture Overview

### Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Desktop Framework**: Electron 30 with `vite-plugin-electron`
- **State Management**: Zustand (separate stores per feature)
- **UI Components**: Custom components (no component library)
- **AI/LLM**: LangChain + LangGraph with DashScope (通义千问) provider
- **Vector Store**: HNSWlib-node for RAG document retrieval
- **Database**: better-sqlite3 for chat history and persistence
- **Mind Map Rendering**: @xyflow/react (React Flow)

### Directory Structure

```
src/                          # Renderer process (React app)
  app/                        # App entry point (App.tsx, main.tsx)
  components/                 # Shared UI components
  features/                   # Feature-based modules
    chat/                     # AI chat panel with streaming
    document-import/          # Document import functionality
    knowledge-base/           # RAG document management
    mindmap/                  # Mind map editor (nodes, store, view)
    review/                   # Review functionality
    settings/                 # App settings management
    shell/                    # App shell (window bar, side panels)
    workspace/                # File tree, workspace management
  shared/                     # Shared utilities
    lib/                      # fileFormat.ts, mindmapTree.ts, autoLayout.ts
    shortcuts/                # Keyboard shortcut system
    types/                    # Shared type definitions

electron/                     # Main process (Node.js/Electron)
  ai/                         # AI service layer
    agents/                   # LangGraph agents and prompts
    graphs/                   # State graph definitions
    memory/                   # Checkpointer, compression, user profiles
    providers/                # LLM provider implementations
    vectorstore/              # HNSWlib vector store
  fs/                         # File system services
  main.ts                     # Electron main entry (IPC handlers)
  preload.ts                  # Context bridge definitions
```

### Key Architectural Patterns

**IPC Communication**: All main/renderer communication goes through `window.mindlane` API exposed in `preload.ts`. Main process handlers are registered in `electron/main.ts` with namespaces like `ai:*`, `file:*`, `workspace:*`.

**Node Registry System**: Mind map nodes use a registry pattern (`src/features/mindmap/nodes/registry.ts`). Each node type extends `NodeTypeDescriptor` and registers itself. This enables:
- Dynamic node type resolution
- Custom properties panels per node type
- Serialization/deserialization hooks
- Context menu customization

**State Management Strategy**:
- `mindmapStore`: Current document state (nodes, edges, dirty flag)
- `workspaceStore`: File system navigation, workspace session
- `aiStore`: Chat sessions, streaming state
- `settingsStore`: User preferences, API keys
- Stores communicate via actions, not direct imports

**AI Agent Architecture** (LangGraph):
- `AgentOrchestrator`: Entry point for all AI operations
- State graphs in `electron/ai/graphs/` using LangGraph's `StateGraph`
- HITL (Human-in-the-Loop) support for confirmation checkpoints
- Tools in `electron/ai/agents/tools/` for document search, mindmap context

**File Format**: `.mindlane` files are JSON with structure:
```typescript
{
  version: '1.0',
  metadata: { title, createdAt, updatedAt },
  mindmap: { nodes[], edges[], viewport },
  documents: [] // Imported document references
}
```

**Node Types**:
- `topic`: Basic mind map node with label
- `palace`: Memory palace with stations, anchor visuals, associations
- `document`: Imported document reference with excerpt

**External Dependencies with Native Modules**:
- `better-sqlite3`: Chat history persistence
- `hnswlib-node`: Vector similarity search
- `pdf-parse` / `mammoth`: Document ingestion

These are marked as external in `vite.config.ts` and unpacked in `electron-builder.json5`.

### Important Implementation Details

**Auto-save**: Documents auto-save at intervals (default 30s) via `saveCurrentDocumentSilently()` in workspace store.

**Shortcuts**: Global keyboard shortcuts use the `ShortcutRegistry` system in `src/shared/shortcuts/`. Shortcuts are registered via `useShortcut()` hook.

**Chat Sessions**: Multi-session chat support with SQLite persistence. Each workspace maintains separate chat history.

**Vector Store Lifecycle**: Initialized with API key; documents indexed on import. Store location: `userData/vectorstore/`.
