import { useEffect, useState } from 'react'
import { Plug, ChevronDown, CircleAlert } from 'lucide-react'
import {
  selectActiveApiKey,
  selectActiveCapabilities,
  useSettingsStore,
} from '@/features/settings/model/settingsStore'
import { ShortcutsList } from './ShortcutsList'
import { resolveArtworkStyle } from '@contracts/palaceArtworkStyle'

/**
 * File/workspace actions the panel exposes in its UI, injected by the
 * composition root. The settings feature sits below mindmap and workspace, so
 * it emits intents instead of reaching up into them.
 */
export interface SettingsFileActions {
  workspacePath: string | null
  restoreLastWorkspaceOnLaunch: boolean
  setRestoreLastWorkspaceOnLaunch: (enabled: boolean) => void
  openWorkspaceDirectory: () => void
  openFile: () => void
  saveActiveFile: () => void
  saveActiveFileAs: () => void
}

type SettingsSectionId = 'about' | 'workspace' | 'ai' | 'editor' | 'integrations'

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; description: string }[] = [
  { id: 'about', label: 'About', description: 'Version and basic info' },
  { id: 'workspace', label: 'Files & Workspace', description: 'Repository and document behavior' },
  { id: 'ai', label: 'AI', description: 'Models and keys' },
  { id: 'integrations', label: 'Integrations', description: 'External service connections' },
  { id: 'editor', label: 'Editor', description: 'Saving and shortcuts' },
]

const AUTO_SAVE_OPTIONS = [
  { value: 5_000, label: '5 seconds' },
  { value: 10_000, label: '10 seconds' },
  { value: 30_000, label: '30 seconds' },
  { value: 60_000, label: '1 minute' },
]

type McpServerStatusInfo = Extract<
  Awaited<ReturnType<NonNullable<typeof window.mindlane>['settings']['mcpStatus']>>,
  { ok: true }
>['data'][number]

const MCP_STATE_LABELS: Record<McpServerStatusInfo['state'], string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  failed: 'Connection failed',
}

// Brand icons live in public/assets, keyed by server id; unknown ids fall back to a generic plug icon.
const MCP_ICONS: Record<string, string> = {
  notion: '/assets/notion.svg',
  obsidian: '/assets/obsidian.svg',
  feishu: '/assets/feishu.svg',
}

/** Short connection guide per MCP: one step per line in steps, shown in the hover bubble; links go through shell.openExternal */
const MCP_TUTORIAL: Record<string, { steps: string[]; links: { label: string; url: string }[] }> = {
  obsidian: {
    steps: [
      'Plugin repo: github.com/coddingtonbear/obsidian-local-rest-api (bundles the MCP service)',
      'Obsidian → Settings → Community plugins: install and enable "Local REST API with MCP"',
      'Enable the encrypted port (HTTPS 27124) in the plugin settings',
      'Paste the plugin API Key into the form and connect',
    ],
    links: [
      {
        label: 'Open plugin repo',
        url: 'https://github.com/coddingtonbear/obsidian-local-rest-api',
      },
    ],
  },
  feishu: {
    steps: [
      'Create a custom app on the Open Platform with document search/read/wiki permissions',
      'Register http://127.0.0.1:44664/callback under "Security Settings → Redirect URL"',
      'Fill in App ID / App Secret; expand with ▾ to fetch the UAT in one click',
      'Once connected, the AI can search and read your cloud documents',
    ],
    links: [
      {
        label: 'Setup guide',
        url: 'https://open.feishu.cn/document/mcp_open_tools/developers-call-remote-mcp-server',
      },
      {
        label: 'Get UAT',
        url: 'https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3',
      },
    ],
  },
}

function McpIntegrationsSection() {
  const [servers, setServers] = useState<McpServerStatusInfo[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formOpenId, setFormOpenId] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [busyUat, setBusyUat] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  const refresh = async () => {
    const res = await window.mindlane?.settings.mcpStatus()
    if (res?.ok) setServers(res.data)
  }

  const runAction = async (serverId: string, connect: boolean) => {
    setBusyId(serverId)
    try {
      const settings = window.mindlane?.settings
      if (connect) await settings?.mcpConnect(serverId)
      else await settings?.mcpDisconnect(serverId)
    } finally {
      await refresh()
      setBusyId(null)
    }
  }

  /** Open the config form and prefill saved credentials (only the fields this server declares) */
  const openFormPrefilled = async (server: McpServerStatusInfo) => {
    let secrets: Record<string, string> = {}
    try {
      const res = await window.mindlane?.settings.mcpGetCredentials(server.id)
      if (res?.ok) secrets = res.data
    } catch {
      // Fall back to an empty form when the main process has not registered this handler yet
      // (e.g. after a reload without a main process restart); it must not block editing
      secrets = {}
    }
    const ids = new Set((server.credentialFields ?? []).map((f) => f.id))
    const prefilled: Record<string, string> = {}
    for (const [k, v] of Object.entries(secrets)) if (ids.has(k)) prefilled[k] = v
    setFormValues(prefilled)
    setFormError(null)
    setFormOpenId(server.id)
  }

  /** Show-config toggle: open → close, closed → open (opening prefills the saved credentials) */
  const toggleForm = (server: McpServerStatusInfo) => {
    if (formOpenId === server.id) {
      setFormOpenId(null)
      setFormValues({})
      setFormError(null)
    } else {
      void openFormPrefilled(server)
    }
  }

  const submitForm = async (server: McpServerStatusInfo) => {
    setBusyId(server.id)
    try {
      const res = await window.mindlane?.settings.mcpConnect(server.id, formValues)
      if (res?.ok) {
        setFormOpenId(null)
        setFormValues({})
        setFormError(null)
      } else {
        setFormError(res?.error ?? 'Connection failed')
      }
    } finally {
      await refresh()
      setBusyId(null)
    }
  }

  /** One-click Feishu UAT: open the authorization page and prefill the uat field on success */
  const acquireUat = async (server: McpServerStatusInfo) => {
    const appId = (formValues['appId'] ?? '').trim()
    const appSecret = (formValues['appSecret'] ?? '').trim()
    if (!appId || !appSecret) {
      setFormError('Fill in App ID and App Secret before fetching the UAT')
      return
    }
    setBusyUat(true)
    setFormError(null)
    try {
      const res = await window.mindlane?.settings.mcpAuthorizeUat({
        serverId: server.id,
        appId,
        appSecret,
      })
      if (res?.ok) {
        setFormValues((v) => ({ ...v, uat: res.data.uat }))
        setFormError('UAT fetched and filled in automatically; click "Connect" to confirm')
      } else {
        setFormError(res?.error ?? 'UAT fetch failed')
      }
    } finally {
      setBusyUat(false)
    }
  }

  if (servers.length === 0) return null

  return (
    <>
      {servers.map((server) => {
        const iconSrc = MCP_ICONS[server.id]
        const connected = server.state === 'connected'
        const busy = busyId === server.id || server.state === 'connecting'
        const hasForm = (server.credentialFields?.length ?? 0) > 0
        const formOpen = formOpenId === server.id
        const statusLabel =
          MCP_STATE_LABELS[server.state] +
          (connected && server.workspaceName ? ` · ${server.workspaceName}` : '')
        return (
          <div className="settings-card__row mcp-server" key={server.id}>
            {iconSrc ? <img src={iconSrc} alt="" width={28} height={28} /> : <Plug size={28} />}
            <div className="mcp-server__text">
              <div className="settings-card__label mcp-server__label">
                {server.displayName}
                {MCP_TUTORIAL[server.id] && (
                  <span className="mcp-tutorial-tip" role="note">
                    <CircleAlert size={14} />
                    <span className="mcp-tutorial-bubble">
                      {MCP_TUTORIAL[server.id].steps.map((step, i) => (
                        <div className="mcp-tutorial-step" key={i}>
                          {i + 1}. {step}
                        </div>
                      ))}
                      {MCP_TUTORIAL[server.id].links.length > 0 && (
                        <div className="mcp-tutorial-links">
                          {MCP_TUTORIAL[server.id].links.map((link) => (
                            <button
                              type="button"
                              key={link.url}
                              className="mcp-tutorial-link"
                              onClick={(e) => {
                                e.stopPropagation()
                                void window.mindlane?.shell.openExternal(link.url)
                              }}
                            >
                              {link.label} ↗
                            </button>
                          ))}
                        </div>
                      )}
                    </span>
                  </span>
                )}
              </div>
              <div className="settings-card__hint">
                {server.state === 'failed' && server.error ? server.error : server.description}
              </div>
            </div>
            <div className="mcp-server__actions">
              <span
                className={`mcp-status-dot${connected ? ' mcp-status-dot--on' : ''}`}
                role="img"
                aria-label={statusLabel}
                title={statusLabel}
              />
              <button
                type="button"
                className={`btn panel-btn${connected ? '' : ' panel-btn--primary'}`}
                disabled={busy}
                onClick={() => {
                  if (busy) return
                  if (connected) void runAction(server.id, false)
                  else if (hasForm && !formOpen) void openFormPrefilled(server)
                  else if (hasForm && formOpen) {
                    setFormOpenId(null)
                    setFormValues({})
                  } else void runAction(server.id, true)
                }}
              >
                {busy ? 'Working…' : connected ? 'Disconnect' : formOpen ? 'Cancel' : 'Connect'}
              </button>
              {hasForm && (
                <button
                  type="button"
                  className="btn panel-btn"
                  disabled={busy}
                  aria-expanded={formOpen}
                  aria-label="Configuration"
                  title={formOpen ? 'Hide configuration' : 'Show configuration'}
                  onClick={() => toggleForm(server)}
                >
                  <ChevronDown
                    size={14}
                    style={{
                      transform: formOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.15s ease',
                    }}
                  />
                </button>
              )}
            </div>
            {formOpen && hasForm && (
              <div className="mcp-server__form">
                {server.credentialFields?.map((field) => (
                  <label className="panel-field" key={field.id}>
                    <span className="panel-field__label">{field.label}</span>
                    <span className="panel-field__input-row">
                      <input
                        className="panel-field__input"
                        type={field.secret ? 'password' : 'text'}
                        value={formValues[field.id] ?? ''}
                        onChange={(e) => {
                          setFormValues((v) => ({ ...v, [field.id]: e.target.value }))
                          setFormError(null)
                        }}
                      />
                      {server.id === 'feishu' && field.id === 'uat' && (
                        <button
                          type="button"
                          className="btn panel-btn"
                          disabled={busyUat}
                          onClick={() => void acquireUat(server)}
                        >
                          {busyUat ? 'Fetching…' : 'Fetch'}
                        </button>
                      )}
                    </span>
                  </label>
                ))}
                {formError && <div className="mcp-server__form-error">{formError}</div>}
                <button
                  type="button"
                  className="btn panel-btn panel-btn--primary"
                  disabled={busy || busyUat}
                  onClick={() => void submitForm(server)}
                >
                  Connect
                </button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export function SettingsPanel({ fileActions }: { fileActions: SettingsFileActions }) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('about')
  const apiKey = useSettingsStore(selectActiveApiKey)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const chatModel = useSettingsStore((s) => s.chatModel)
  const setChatModel = useSettingsStore((s) => s.setChatModel)
  const palaceArtworkStyle = useSettingsStore((s) => s.palaceArtworkStyle)
  const setPalaceArtworkStyle = useSettingsStore((s) => s.setPalaceArtworkStyle)
  const capabilities = useSettingsStore(selectActiveCapabilities)
  const autoSaveIntervalMs = useSettingsStore((s) => s.autoSaveIntervalMs)
  const setAutoSaveIntervalMs = useSettingsStore((s) => s.setAutoSaveIntervalMs)
  const providers = useSettingsStore((s) => s.providers)
  const activeChatProvider = useSettingsStore((s) => s.activeChatProvider)
  const setActiveChatProvider = useSettingsStore((s) => s.setActiveChatProvider)
  const {
    workspacePath,
    restoreLastWorkspaceOnLaunch,
    setRestoreLastWorkspaceOnLaunch,
    openWorkspaceDirectory,
    openFile,
    saveActiveFile,
    saveActiveFileAs,
  } = fileActions

  const activeProvider = providers.find((p) => p.id === activeChatProvider) ?? providers[0]
  const models = activeProvider?.models ?? []
  const chatEnabled = capabilities.includes('chat')
  const visionEnabled = capabilities.includes('vision')
  const imageGenEnabled = capabilities.includes('imageGen')
  const effectivePalaceArtwork =
    resolveArtworkStyle(palaceArtworkStyle, new Set(capabilities)) === 'raster'
      ? 'Concept image (text-to-image)'
      : 'SVG vector artwork'

  return (
    <div className="settings-page">
      <aside className="settings-page__sidebar">
        <nav className="settings-page__nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`settings-page__nav-item${activeSection === section.id ? ' settings-page__nav-item--active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="settings-page__nav-label">{section.label}</span>
              <span className="settings-page__nav-desc">{section.description}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="settings-page__content">
        <div className="settings-page__sections">
          <section className="settings-card" hidden={activeSection !== 'about'}>
            <div className="settings-card__title">About the app</div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">Current version</div>
                <div className="settings-card__value">0.0.0</div>
                <div className="settings-card__hint">This is a desktop preview build.</div>
              </div>
            </div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">Workspace status</div>
                <div className="settings-card__value">
                  {workspacePath ? 'Workspace open' : 'No workspace open'}
                </div>
                <div className="settings-card__hint">
                  {workspacePath ?? 'No local repository selected yet'}
                </div>
              </div>
            </div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">Troubleshooting logs</div>
                <div className="settings-card__hint">
                  When something goes wrong, open the log directory and send the log files to the
                  developer.
                </div>
              </div>
              <button
                type="button"
                className="btn panel-btn"
                onClick={() => void window.mindlane?.shell.openLogs()}
              >
                Open log directory
              </button>
            </div>
          </section>

          <section className="settings-card" hidden={activeSection !== 'workspace'}>
            <div className="settings-card__title">Files & Workspace</div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">Current repository</div>
                <div className="settings-card__value">
                  {workspacePath ?? 'No local repository open'}
                </div>
                <div className="settings-card__hint">
                  Switching repositories auto-saves the current edits first.
                </div>
              </div>
              <button
                type="button"
                className="btn panel-btn panel-btn--primary"
                onClick={openWorkspaceDirectory}
              >
                Switch repository
              </button>
            </div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">Restore on launch</div>
                <div className="settings-card__value">Open the last workspace and file</div>
                <div className="settings-card__hint">
                  Restores the previous work context when the app restarts.
                </div>
              </div>
              <label className="settings-card__switch">
                <input
                  type="checkbox"
                  checked={restoreLastWorkspaceOnLaunch}
                  onChange={(e) => setRestoreLastWorkspaceOnLaunch(e.target.checked)}
                />
                <span>{restoreLastWorkspaceOnLaunch ? 'On' : 'Off'}</span>
              </label>
            </div>
            <div className="settings-card__action-group">
              <button type="button" className="btn panel-btn" onClick={openFile}>
                Open file
              </button>
              <button type="button" className="btn panel-btn" onClick={saveActiveFile}>
                Save now
              </button>
              <button type="button" className="btn panel-btn" onClick={saveActiveFileAs}>
                Save As
              </button>
            </div>
          </section>

          <section className="settings-card" hidden={activeSection !== 'ai'}>
            <div className="settings-card__title">AI</div>
            {providers.length > 1 && (
              <div className="panel-field">
                <label className="panel-field__label" htmlFor="settings-provider">
                  AI provider
                </label>
                <select
                  id="settings-provider"
                  className="panel-field__select"
                  value={activeChatProvider}
                  onChange={(e) => setActiveChatProvider(e.target.value)}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="panel-field">
              <label className="panel-field__label" htmlFor="settings-apikey">
                API Key
              </label>
              <input
                id="settings-apikey"
                type="password"
                className="panel-field__input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${activeProvider?.displayName ?? 'API'} Key`}
              />
            </div>
            <div className="panel-field">
              <label className="panel-field__label" htmlFor="settings-model">
                Model
              </label>
              <select
                id="settings-model"
                className="panel-field__select"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
              >
                <option value="" disabled>
                  Select a model
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="panel-field palace-artwork-field" disabled={!imageGenEnabled}>
              <legend className="panel-field__label">Memory palace artwork</legend>
              <div className="settings-segmented-control">
                <label>
                  <input
                    type="radio"
                    name="palace-artwork-style"
                    value="vector"
                    checked={palaceArtworkStyle === 'vector'}
                    onChange={() => setPalaceArtworkStyle('vector')}
                  />
                  <span>Use SVG vector artwork</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="palace-artwork-style"
                    value="raster"
                    checked={palaceArtworkStyle === 'raster'}
                    onChange={() => setPalaceArtworkStyle('raster')}
                  />
                  <span>Use an image model</span>
                </label>
              </div>
              {!imageGenEnabled && (
                <div className="settings-card__hint">
                  The current provider has no text-to-image capability; vector artwork will be used
                </div>
              )}
            </fieldset>
            {activeProvider && (
              <div className="settings-card__hint">
                {activeProvider.displayName} supports:
                {chatEnabled && ' chat'}
                {visionEnabled && ' vision'}
                {imageGenEnabled && ' text-to-image'}
                {' | '}Memory palace: {effectivePalaceArtwork}
              </div>
            )}
          </section>

          <section className="settings-card" hidden={activeSection !== 'integrations'}>
            <div className="settings-card__title">Integrations</div>
            <McpIntegrationsSection />
          </section>

          <section className="settings-card" hidden={activeSection !== 'editor'}>
            <div className="settings-card__title">Editor</div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">Auto save</div>
                <div className="settings-card__hint">
                  Only applies to documents that already have a real file path.
                </div>
              </div>
              <select
                className="panel-field__select settings-card__select"
                value={autoSaveIntervalMs}
                onChange={(e) => setAutoSaveIntervalMs(Number(e.target.value))}
              >
                {AUTO_SAVE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">Shortcuts</div>
                <div className="settings-card__hint">
                  Every mindmap and app-level shortcut is listed here.
                </div>
              </div>
            </div>
            <div className="shortcuts-inline">
              <ShortcutsList />
            </div>
            <div className="settings-card__hint">
              Unsaved drafts are auto-saved first when you switch repositories or open another file,
              so the flow is not interrupted over and over.
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
