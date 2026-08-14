import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage } from '@langchain/core/messages'
import { initAgentServices, type AgentServices } from '../service.js'

/**
 * 装配接缝：只测外部行为（服务齐全、目录创建、sessionManager 读写、
 * checkpointer adapter 就绪），不断言内部字段或调用顺序。
 * sessionManager ↔ checkpointer 接线的深层行为由既有
 * consolidator.integration.test.ts 覆盖，不在本接缝重复。
 */
describe('initAgentServices 装配', () => {
  let tmpDir: string
  let services: AgentServices

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiservice-assembly-'))
    services = await initAgentServices(tmpDir)
  })

  afterEach(() => {
    services.sessionManager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('装配出 5 个全非可选服务', () => {
    expect(services.sessionManager).toBeDefined()
    expect(services.checkpointer).toBeDefined()
    expect(services.memoryManager).toBeDefined()
    expect(services.memoryExtractor).toBeDefined()
    expect(services.editLogStore).toBeDefined()
  })

  it('创建 memory 目录', () => {
    expect(fs.existsSync(path.join(tmpDir, 'memory'))).toBe(true)
    expect(fs.statSync(path.join(tmpDir, 'memory')).isDirectory()).toBe(true)
  })

  it('sessionManager 可用：runInWorkspace 内读写往返', async () => {
    const sessionId = 'session-assembly'
    services.sessionManager.setWorkspace('/workspace/test', 'workspace-uuid-assembly')
    await services.sessionManager.runInWorkspace('workspace-uuid-assembly', () =>
      services.sessionManager.saveMessage(sessionId, new HumanMessage('你好'), 'file-uuid-a'),
    )
    const messages = await services.sessionManager.runInWorkspace('workspace-uuid-assembly', () =>
      services.sessionManager.loadSessionMessages(sessionId),
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user', content: '你好' })
  })

  it('checkpointer adapter 就绪', () => {
    expect(services.checkpointer.getAdapter()).toBeDefined()
  })
})
