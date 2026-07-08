import { describe, it, expect, beforeEach } from 'vitest'
import { mindmapRegistry } from '../mindmapRegistry'

describe('MindmapRegistry', () => {
  beforeEach(() => {
    mindmapRegistry.releaseAll()
  })

  it('should reuse the same instance for the same key', () => {
    const a = mindmapRegistry.getOrCreate('/file-a.mindlane')
    const b = mindmapRegistry.getOrCreate('/file-a.mindlane')
    expect(a).toBe(b)
  })

  it('should isolate history between files', () => {
    const fileA = mindmapRegistry.getOrCreate('/a.mindlane')
    fileA.newFile('A')
    const rootA = fileA.store.getState().nodes[0]!.id
    fileA.editor.addChild(rootA)
    expect(fileA.store.getState().canUndo).toBe(true)

    const fileB = mindmapRegistry.getOrCreate('/b.mindlane')
    fileB.newFile('B')
    expect(fileB.store.getState().canUndo).toBe(false)

    mindmapRegistry.setActive('/a.mindlane')
    expect(mindmapRegistry.getActive()?.store.getState().canUndo).toBe(true)
  })

  it('should preserve history when switching active files', () => {
    const fileA = mindmapRegistry.getOrCreate('/a.mindlane')
    fileA.newFile('A')
    const rootA = fileA.store.getState().nodes[0]!.id
    fileA.editor.addChild(rootA)

    mindmapRegistry.setActive('/a.mindlane')
    const fileB = mindmapRegistry.getOrCreate('/b.mindlane')
    fileB.newFile('B')
    mindmapRegistry.setActive('/b.mindlane')

    // 切换回 a 时历史应保留
    mindmapRegistry.setActive('/a.mindlane')
    expect(mindmapRegistry.getActive()?.store.getState().canUndo).toBe(true)
  })

  it('should drop oldest undo entry after 10 commands', () => {
    const file = mindmapRegistry.getOrCreate('/cap.mindlane')
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
    const file = mindmapRegistry.getOrCreate('/close.mindlane')
    file.newFile('Close')
    const root = file.store.getState().nodes[0]!.id
    file.editor.addChild(root)

    mindmapRegistry.setActive('/close.mindlane')
    mindmapRegistry.release('/close.mindlane')

    expect(mindmapRegistry.get('/close.mindlane')).toBeUndefined()
    expect(mindmapRegistry.getActive()).toBeNull()
  })

  it('should rename instance key without losing history', () => {
    const file = mindmapRegistry.getOrCreate('/old.mindlane')
    file.newFile('Old')
    const root = file.store.getState().nodes[0]!.id
    file.editor.addChild(root)

    mindmapRegistry.renameKey('/old.mindlane', '/new.mindlane')

    expect(mindmapRegistry.get('/old.mindlane')).toBeUndefined()
    const renamed = mindmapRegistry.get('/new.mindlane')
    expect(renamed?.store.getState().canUndo).toBe(true)
    expect(renamed?.key).toBe('/new.mindlane')
  })
})
