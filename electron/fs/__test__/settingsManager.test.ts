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

  it('migrates legacy workspace-scoped keys once when lastWorkspacePath matches', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastWorkspacePath: workspacePath,
        lastOpenedFilePath: '/old/file.mindlane',
        expandedFolderPaths: ['/a', '/b'],
      }),
    )

    const migrated = await settings.migrateLegacyWorkspaceState(workspacePath)

    expect(migrated).toEqual({
      lastOpenedFilePath: '/old/file.mindlane',
      expandedFolderPaths: ['/a', '/b'],
    })

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastOpenedFilePath).toBeUndefined()
    expect(parsed.expandedFolderPaths).toBeUndefined()
    expect(parsed.lastWorkspacePath).toBe(workspacePath)
    expect(parsed.apiKey).toBe('key')
  })

  it('does not migrate legacy keys when lastWorkspacePath does not match', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastWorkspacePath: '/other/workspace',
        lastOpenedFilePath: '/old/file.mindlane',
        expandedFolderPaths: ['/a'],
      }),
    )

    const migrated = await settings.migrateLegacyWorkspaceState(workspacePath)

    expect(migrated).toBeNull()

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastOpenedFilePath).toBe('/old/file.mindlane')
    expect(parsed.expandedFolderPaths).toEqual(['/a'])
  })

  it('returns null when no legacy workspace-scoped keys exist', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastWorkspacePath: workspacePath,
      }),
    )

    const migrated = await settings.migrateLegacyWorkspaceState(workspacePath)

    expect(migrated).toBeNull()
  })
})
