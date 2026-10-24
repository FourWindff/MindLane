/**
 * The document a blank mindmap starts from. Lives in the contracts layer
 * because both the main-process document service (reset) and the renderer
 * (a fresh file before the document state arrives) need the same anchor.
 */

import type { MindmapDocument } from './types.js'

export function createInitialDocument(): MindmapDocument {
  return {
    nodes: [
      {
        id: 'root',
        type: 'text',
        position: { x: 0, y: 0 },
        data: { label: 'Central Topic', depth: 0, branchIndex: -1 },
      },
    ],
    edges: [],
  }
}
