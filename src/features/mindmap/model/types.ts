// Document semantics (commands, snapshots, transient flags) live in the
// contracts layer now that the main process owns the document. Re-exported here
// so the renderer feature keeps its existing import surface.
export type { MindmapCommand } from '@contracts/mindmapDocument/types'
