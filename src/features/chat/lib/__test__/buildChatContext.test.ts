import { afterEach, describe, expect, it } from 'vitest'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { useWorkspaceStore } from '@/app/workspace/store'
import { createEmptyFile } from '@/shared/lib/fileFormat'
import { buildChatContext } from '../buildChatContext'

describe('buildChatContext workspace files', () => {
  afterEach(() => {
    mindmapRegistry.releaseAll()
  })

  it('derives workspaceFiles from the tree, nested files included', () => {
    const filePath = '/ws/root.mindlane'
    const instance = mindmapRegistry.getOrCreate(filePath)
    instance.load(filePath, createEmptyFile('Root'), '/ws')
    mindmapRegistry.setActive(filePath)
    useWorkspaceStore.setState({
      workspacePath: '/ws',
      tree: [
        {
          name: 'sub',
          path: '/ws/sub',
          type: 'directory',
          lastModifiedAt: '2026-01-01T00:00:00.000Z',
          children: [
            {
              name: 'nested.mindlane',
              path: '/ws/sub/nested.mindlane',
              type: 'file',
              lastModifiedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        {
          name: 'top.mindlane',
          path: '/ws/top.mindlane',
          type: 'file',
          lastModifiedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    expect(buildChatContext().workspaceFiles).toEqual([
      { name: 'nested.mindlane', filePath: '/ws/sub/nested.mindlane' },
      { name: 'top.mindlane', filePath: '/ws/top.mindlane' },
    ])
  })
})
