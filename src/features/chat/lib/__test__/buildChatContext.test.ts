import { afterEach, describe, expect, it } from 'vitest'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { resetRegistry } from '@/features/mindmap/model/__test__/registryReset'
import { useWorkspaceStore } from '@/app/workspace/store'
import { createEmptyFile } from '@contracts/fileFormat'
import { buildChatContext } from '../buildChatContext'

describe('buildChatContext workspace files', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('derives workspaceFiles from the tree, nested files included', () => {
    const filePath = '/ws/root.mindlane'
    const instance = openFileRegistry.getOrCreate(filePath)
    instance.load(filePath, createEmptyFile('Root'), '/ws')
    openFileRegistry.setActive(filePath)
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
