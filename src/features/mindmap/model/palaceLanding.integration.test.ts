import { describe, expect, it } from 'vitest'
import { MindmapEditor } from './editor'
import { createMindmapStore } from './store'
import { insertPalacePlaceholder } from './palacePlaceholder'
import { getDocumentLoopbackService } from './documentLoopback.testutil'
import { createMindmapWrite } from '../../../../electron/main/document/writeService'
import { createEmptyFile } from '@contracts/fileFormat'
import { serializePalaceNodeXml } from '@contracts/mindmapXml'

/**
 * Manual palace run, end to end over the loopback document service: the renderer
 * inserts the placeholder, the main-process write service lands the palace into
 * the authoritative document, and the renderer reconciles its run state from the
 * versioned state push (no landing code in the renderer).
 */
function setup() {
  const store = createMindmapStore()
  const editor = new MindmapEditor(store)
  editor.loadFile('', createEmptyFile('Palace landing'), null)
  const chapter = editor.addChild('root', { label: 'Chapter' }).nodeId
  const first = editor.addChild(chapter, { label: 'First' }).nodeId
  const second = editor.addChild(chapter, { label: 'Second' }).nodeId
  return { store, editor, first, second }
}

describe('palace landing over the document write service', () => {
  it('updates the placeholder in place and the view retires its run state', async () => {
    const { store, editor, first, second } = setup()
    const { nodeId } = insertPalacePlaceholder(editor, [first, second])
    await editor.whenSettled()

    const write = createMindmapWrite({ documentService: getDocumentLoopbackService() })
    const xml = serializePalaceNodeXml({
      label: 'Landed palace',
      // Artwork is optional decoration; a palace without a picture still lands.
      imageUrl: '',
      stations: [
        {
          order: 1,
          content: 'First',
          anchorVisual: 'furnace',
          association: 'the furnace is the entry',
          x: 0.2,
          y: 0.3,
          linkedNodeId: first,
        },
      ],
      sourceNodeIds: [first, second],
    })

    const ack = await write(store.getState().fileUuid, 'landPalace', {
      xml,
      placeholderNodeId: nodeId,
    })

    expect(ack).toMatchObject({
      ok: true,
      action: 'landPalace',
      data: { nodeId, updatedPlaceholder: true },
    })
    const state = store.getState()
    const palace = state.nodes.find((node) => node.id === nodeId)!
    expect(palace.data.label).toBe('Landed palace')
    expect(palace.data.generating).toBeUndefined()
    expect(palace.data.expanded).toBe(true)
    // The selection the palace collected stops showing the run's busy marker.
    expect(state.nodes.find((node) => node.id === first)!.data.processing).toBeUndefined()
    expect(state.nodes.find((node) => node.id === second)!.data.processing).toBeUndefined()
    // One palace, no duplicate node from a second landing pass.
    expect(state.nodes.filter((node) => node.type === 'palace')).toHaveLength(1)
  })
})
