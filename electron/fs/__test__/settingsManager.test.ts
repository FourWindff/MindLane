import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SettingsManager } from '../settingsManager.js'

describe('SettingsManager', () => {
  let tmpDir: string
  let settings: SettingsManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-settings-'))
    settings = new SettingsManager(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('drops legacy workspace-scoped keys when saving', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastOpenedFilePath: '/old/file.mindlane',
        expandedFolderPaths: ['/a'],
      }),
    )

    await settings.update({ chatModel: 'new-model' })
    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw)

    expect(parsed.chatModel).toBe('new-model')
    expect(parsed.lastOpenedFilePath).toBeUndefined()
    expect(parsed.expandedFolderPaths).toBeUndefined()
  })
})
