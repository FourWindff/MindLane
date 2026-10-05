import { describe, it, expect, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { useEffect } from 'react'
import { MindmapEditorProvider } from '@/features/mindmap/components/EditorProvider'
import {
  useActiveOpenFile,
  useActiveMindmapEditor,
  useActiveMindmapStore,
} from '@/features/mindmap/hooks/useActiveOpenFile'
import { MindmapEditor } from '@/features/mindmap/model/editor'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { resetRegistry } from '@/features/mindmap/model/registryReset.testutil'
import { createEmptyFile } from '@contracts/fileFormat'

function ProbeComponent() {
  const instance = useActiveOpenFile()
  const editor = useActiveMindmapEditor()
  const nodeCount = useActiveMindmapStore((s) => s.nodes.length)

  useEffect(() => {
    // Only there so React sees a side effect and does not optimize the component away
  }, [instance, editor, nodeCount])

  return (
    <div data-testid="probe">
      <div data-testid="editor-type">{editor instanceof MindmapEditor ? 'editor' : 'unknown'}</div>
      <div data-testid="node-count">{nodeCount}</div>
      <div data-testid="instance-key">{instance.key}</div>
    </div>
  )
}

function prepareActiveInstance(key: string) {
  resetRegistry()
  const instance = openFileRegistry.getOrCreate(key)
  instance.load('/test.mindlane', createEmptyFile('Test file'), null)
  openFileRegistry.setActive(key)
  return instance
}

describe('MindmapEditorProvider', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('should provide the active OpenFile with editor and store', () => {
    prepareActiveInstance('/test.mindlane')

    const html = renderToString(
      <MindmapEditorProvider>
        <ProbeComponent />
      </MindmapEditorProvider>,
    )

    expect(html).toContain('editor')
    // A default empty file holds a single root node
    expect(html).toContain('>1<')
    expect(html).toContain('/test.mindlane')
  })
})
