import { describe, expect, it } from 'vitest'
import { MindmapEditor } from './editor'
import { createMindmapStore } from './store'
import { insertPalacePlaceholder } from './palacePlaceholder'
import { createEmptyFile } from '@contracts/fileFormat'

/**
 * The manual palace run's placeholder is the renderer-side half of the
 * deterministic landing: it takes the selection's slot and re-hangs it under the
 * progress node, while the landing itself runs in the main process.
 */
function setup() {
  const store = createMindmapStore()
  const editor = new MindmapEditor(store)
  editor.loadFile('', createEmptyFile('Palace placeholder'), null)
  const chapter = editor.addChild('root', { label: 'Chapter' }).nodeId
  const first = editor.addChild(chapter, { label: 'First' }).nodeId
  const second = editor.addChild(chapter, { label: 'Second' }).nodeId
  return { store, editor, chapter, first, second }
}

describe('insertPalacePlaceholder', () => {
  it('lands a progress palace in the slot of the first source node and re-hangs the selection', async () => {
    const { store, editor, chapter, first, second } = setup()

    const { nodeId } = insertPalacePlaceholder(editor, [first, second])
    await editor.whenSettled()

    const state = store.getState()
    const palace = state.nodes.find((node) => node.id === nodeId)!
    expect(palace.type).toBe('palace')
    expect(palace.data).toMatchObject({
      label: 'Generating…',
      sourceNodeIds: [first, second],
      generating: true,
    })
    const hasEdge = (source: string, target: string) =>
      state.edges.some((edge) => edge.source === source && edge.target === target)
    expect(hasEdge(chapter, nodeId)).toBe(true)
    expect(hasEdge(nodeId, first)).toBe(true)
    expect(hasEdge(nodeId, second)).toBe(true)
    expect(hasEdge(chapter, first)).toBe(false)
    expect(hasEdge(chapter, second)).toBe(false)
    // The sources show the run's busy marker until the landing retires it.
    expect(state.nodes.find((node) => node.id === first)!.data.processing).toBe(true)
    expect(state.nodes.find((node) => node.id === second)!.data.processing).toBe(true)
  })

  it('keeps the run flags out of the authoritative document', async () => {
    const { store, editor, first } = setup()

    const { nodeId } = insertPalacePlaceholder(editor, [first])
    await editor.whenSettled()

    const document = store.getState().documentNodes.find((node) => node.id === nodeId)!
    expect(document.data).not.toHaveProperty('generating')
    expect(document.data.sourceNodeIds).toEqual([first])
  })
})
