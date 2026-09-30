import { describe, it, expect, beforeEach } from 'vitest'
import { openFileRegistry } from './openFileRegistry'
import { resetRegistry } from './registryReset.testutil'

describe('OpenFileRegistry', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('should reuse the same instance for the same key', () => {
    const a = openFileRegistry.getOrCreate('/file-a.mindlane')
    const b = openFileRegistry.getOrCreate('/file-a.mindlane')
    expect(a).toBe(b)
  })

  it('should isolate history between files', () => {
    const fileA = openFileRegistry.getOrCreate('/a.mindlane')
    fileA.newFile('A')
    const rootA = fileA.store.getState().nodes[0]!.id
    fileA.editor.addChild(rootA)
    expect(fileA.store.getState().canUndo).toBe(true)

    const fileB = openFileRegistry.getOrCreate('/b.mindlane')
    fileB.newFile('B')
    expect(fileB.store.getState().canUndo).toBe(false)

    openFileRegistry.setActive('/a.mindlane')
    expect(openFileRegistry.getActive()?.store.getState().canUndo).toBe(true)
  })

  it('should preserve history when switching active files', () => {
    const fileA = openFileRegistry.getOrCreate('/a.mindlane')
    fileA.newFile('A')
    const rootA = fileA.store.getState().nodes[0]!.id
    fileA.editor.addChild(rootA)

    openFileRegistry.setActive('/a.mindlane')
    const fileB = openFileRegistry.getOrCreate('/b.mindlane')
    fileB.newFile('B')
    openFileRegistry.setActive('/b.mindlane')

    // 切换回 a 时历史应保留
    openFileRegistry.setActive('/a.mindlane')
    expect(openFileRegistry.getActive()?.store.getState().canUndo).toBe(true)
  })

  it('should drop oldest undo entry after 10 commands', () => {
    const file = openFileRegistry.getOrCreate('/cap.mindlane')
    file.newFile('Cap')
    const root = file.store.getState().nodes[0]!.id

    const nodeIds: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const { nodeId } = file.editor.addChild(root)
      nodeIds.push(nodeId)
    }

    // 撤销 10 次后应剩下 root 和最早未被丢弃的 2 个子节点
    for (let i = 0; i < 10; i += 1) {
      file.editor.undo()
    }
    expect(file.store.getState().nodes.length).toBe(3)
    expect(file.store.getState().canUndo).toBe(false)
  })

  it('should release instance history on close', () => {
    const file = openFileRegistry.getOrCreate('/close.mindlane')
    file.newFile('Close')
    const root = file.store.getState().nodes[0]!.id
    file.editor.addChild(root)

    openFileRegistry.setActive('/close.mindlane')
    openFileRegistry.release('/close.mindlane')

    expect(openFileRegistry.get('/close.mindlane')).toBeUndefined()
    expect(openFileRegistry.getActive()).toBeNull()
  })

  it('should rename instance key without losing history', () => {
    const file = openFileRegistry.getOrCreate('/old.mindlane')
    file.newFile('Old')
    const root = file.store.getState().nodes[0]!.id
    file.editor.addChild(root)

    openFileRegistry.renameKey('/old.mindlane', '/new.mindlane')

    expect(openFileRegistry.get('/old.mindlane')).toBeUndefined()
    const renamed = openFileRegistry.get('/new.mindlane')
    expect(renamed?.store.getState().canUndo).toBe(true)
    expect(renamed?.key).toBe('/new.mindlane')
  })
})
