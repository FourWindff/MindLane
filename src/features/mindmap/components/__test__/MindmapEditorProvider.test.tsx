import { describe, it, expect, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { useEffect } from 'react'
import { MindmapEditorProvider } from '@/features/mindmap/components/MindmapEditorProvider'
import { useActiveMindmapInstance } from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'

function ProbeComponent() {
  const instance = useActiveMindmapInstance()
  const editor = useActiveMindmapEditor()
  const nodeCount = useActiveMindmapStore((s) => s.nodes.length)

  useEffect(() => {
    // 仅用于让 React 认为组件有副作用，避免被优化掉
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
  mindmapRegistry.releaseAll()
  const instance = mindmapRegistry.getOrCreate(key)
  instance.newFile('测试')
  mindmapRegistry.setActive(key)
  return instance
}

describe('MindmapEditorProvider', () => {
  afterEach(() => {
    mindmapRegistry.releaseAll()
  })

  it('should provide the active MindmapInstance with editor and store', () => {
    prepareActiveInstance('/test.mindlane')

    const html = renderToString(
      <MindmapEditorProvider>
        <ProbeComponent />
      </MindmapEditorProvider>,
    )

    expect(html).toContain('editor')
    // 默认空文件包含一个 root 节点
    expect(html).toContain('>1<')
    expect(html).toContain('/test.mindlane')
  })
})
