import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { SettingsPanel } from '../SettingsPanel'

const settingsState = vi.hoisted(() => ({
  current: {
    loaded: true,
    activeChatProvider: 'test-provider',
    apiKey: 'key',
    chatModel: 'test-model',
    palaceArtworkStyle: 'raster' as 'vector' | 'raster',
    autoSaveIntervalMs: 30_000,
    providers: [
      {
        id: 'test-provider',
        displayName: 'Test Provider',
        models: [{ id: 'test-model', displayName: 'Test Model' }],
        capabilities: ['chat'],
      },
    ],
    capabilities: ['chat'],
    setApiKey: vi.fn(),
    setChatModel: vi.fn(),
    setPalaceArtworkStyle: vi.fn(),
    setAutoSaveIntervalMs: vi.fn(),
    setActiveChatProvider: vi.fn(),
  },
}))

const workspaceState = {
  restoreLastWorkspaceOnLaunch: true,
  setRestoreLastWorkspaceOnLaunch: vi.fn(),
  openWorkspaceDirectory: vi.fn(),
  workspacePath: null,
  syncAfterFileSaved: vi.fn(),
}

vi.mock('@/features/mindmap/hooks/useActiveMindmapInstance', () => ({
  useActiveMindmapInstance: () => ({ store: { getState: vi.fn() } }),
}))

vi.mock('@/features/mindmap/model/mindmapRegistry', () => ({
  mindmapRegistry: { getOrCreate: vi.fn(), setActive: vi.fn() },
}))

vi.mock('@/app/workspace/store', () => ({
  useWorkspaceStore: (selector: (state: typeof workspaceState) => unknown) =>
    selector(workspaceState),
}))

vi.mock('../../model/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settingsState.current) => unknown) =>
    selector(settingsState.current),
}))

vi.mock('@/shared/shortcuts/ShortcutsList', () => ({ ShortcutsList: () => null }))

function renderSettings() {
  const html = ReactDOMServer.renderToStaticMarkup(<SettingsPanel />)
  const { document } = parseHTML(html)
  return { document, text: html.replaceAll('<!-- -->', '') }
}

describe('SettingsPanel palace artwork setting', () => {
  beforeEach(() => {
    settingsState.current.palaceArtworkStyle = 'raster'
    settingsState.current.capabilities = ['chat']
  })

  it('disables raster and explains the vector fallback without image generation', () => {
    const { document, text } = renderSettings()
    const vector = document.querySelector('input[value="vector"]') as HTMLInputElement
    const raster = document.querySelector('input[value="raster"]') as HTMLInputElement

    expect(raster.hasAttribute('checked')).toBe(true)
    expect(vector.closest('fieldset')?.hasAttribute('disabled')).toBe(true)
    expect(text).toContain('当前 provider 无文生图能力，将使用矢量图')
    expect(text).toContain('记忆宫殿：SVG 矢量图')
  })

  it('enables raster and describes the effective concept-image carrier', () => {
    settingsState.current.capabilities = ['chat', 'imageGen']

    const { document, text } = renderSettings()
    const raster = document.querySelector('input[value="raster"]') as HTMLInputElement

    expect(raster.closest('fieldset')?.hasAttribute('disabled')).toBe(false)
    expect(text).toContain('记忆宫殿：概念图（文生图）')
    expect(text).not.toContain('当前 provider 无文生图能力')
  })
})
