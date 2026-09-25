import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatInputBar } from '../ChatInputBar'

/**
 * SSR test (repo convention): renderToString reads a store's *initial* state, so
 * the stores are mocked with a mutable object instead of being driven through
 * zustand's setState.
 */
const mockState = vi.hoisted(() => ({
  ai: {
    busy: false,
    hasFile: false,
    attachedDocument: null,
    setAttachedDocument: vi.fn(),
    sendChatMessage: vi.fn(async () => true),
    stopChatStream: vi.fn(),
    inputDraft: '',
    setInputDraft: vi.fn(),
  },
  settings: { loaded: true, apiKey: 'test-key', chatModel: 'test-model' },
  workspace: { workspacePath: '/workspace' as string | null },
}))

vi.mock('@/features/chat/hooks/useChatContext', () => ({
  useChatContext: () => ({ selectedNodes: [], clearNodeSelection: vi.fn() }),
}))

vi.mock('@/features/chat/model/aiStore', async () => {
  const actual = await vi.importActual<typeof import('@/features/chat/model/aiStore')>(
    '@/features/chat/model/aiStore',
  )
  return {
    ...actual,
    useAiStore: (selector?: (state: unknown) => unknown) =>
      selector ? selector(mockState.ai) : mockState.ai,
    selectCurrentChatBusy: () => mockState.ai.busy,
    selectCurrentChatHasFile: () => mockState.ai.hasFile,
  }
})

vi.mock('@/app/settings/model/settingsStore', async () => {
  const actual = await vi.importActual<typeof import('@/app/settings/model/settingsStore')>(
    '@/app/settings/model/settingsStore',
  )
  return {
    ...actual,
    useSettingsStore: (selector?: (state: unknown) => unknown) =>
      selector ? selector(mockState.settings) : mockState.settings,
  }
})

vi.mock('@/app/workspace/store', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/workspace/store')>('@/app/workspace/store')
  return {
    ...actual,
    useWorkspaceStore: (selector?: (state: unknown) => unknown) =>
      selector ? selector(mockState.workspace) : mockState.workspace,
  }
})

function renderInputBar(): string {
  return ReactDOMServer.renderToString(<ChatInputBar onOpenSettings={vi.fn()} />)
}

describe('ChatInputBar (entry conversation)', () => {
  beforeEach(() => {
    mockState.ai.busy = false
    mockState.ai.hasFile = false
    mockState.ai.attachedDocument = null
    mockState.settings = { loaded: true, apiKey: 'test-key', chatModel: 'test-model' }
    mockState.workspace.workspacePath = '/workspace'
  })

  it('is usable with no file open (entry conversation)', () => {
    const html = renderInputBar()

    expect(html).toContain('chat-input-bar__textarea')
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('请先打开一个 .mindlane 文件')
  })

  it('is disabled without a workspace (nothing to create the file in)', () => {
    mockState.workspace.workspacePath = null

    expect(renderInputBar()).toContain('disabled')
  })

  it('is disabled while the provider settings are incomplete', () => {
    mockState.ai.hasFile = true
    mockState.settings = { loaded: true, apiKey: '', chatModel: '' }

    const html = renderInputBar()

    expect(html).toContain('disabled')
    expect(html).toContain('请先在设置中配置 API Key 并选择模型')
  })
})
