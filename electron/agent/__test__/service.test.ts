import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage } from '@langchain/core/messages'
import { initAgentServices, type AgentServices } from '../service.js'

/**
 * Assembly seam: only external behavior is tested (services present, directories
 * created, sessionManager read/write, checkpointer adapter ready), with no assertions
 * on internal fields or call order. The deep behaviour of the
 * sessionManager ↔ checkpointer wiring is covered by the existing
 * consolidator.integration.test.ts and is not repeated at this seam.
 */
describe('initAgentServices assembly', () => {
  let tmpDir: string
  let services: AgentServices

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiservice-assembly-'))
    services = await initAgentServices(tmpDir)
  })

  afterEach(() => {
    services.sessionManager.close()
    services.checkpointer.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('assembles 5 non-optional services', () => {
    expect(services.sessionManager).toBeDefined()
    expect(services.checkpointer).toBeDefined()
    expect(services.memoryManager).toBeDefined()
    expect(services.memoryExtractor).toBeDefined()
    expect(services.editLogStore).toBeDefined()
  })

  it('creates the memory directory', () => {
    expect(fs.existsSync(path.join(tmpDir, 'memory'))).toBe(true)
    expect(fs.statSync(path.join(tmpDir, 'memory')).isDirectory()).toBe(true)
  })

  it('sessionManager works: read/write round-trip inside runInWorkspace', async () => {
    const sessionId = 'session-assembly'
    await services.sessionManager.runInWorkspace('workspace-uuid-assembly', () =>
      services.sessionManager.saveMessage(sessionId, new HumanMessage('hello'), 'file-uuid-a'),
    )
    const messages = await services.sessionManager.runInWorkspace('workspace-uuid-assembly', () =>
      services.sessionManager.loadSessionMessages(sessionId),
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello' })
  })

  it('checkpointer adapter is ready', () => {
    expect(services.checkpointer.getAdapter()).toBeDefined()
  })
})
