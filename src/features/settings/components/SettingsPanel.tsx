import { useEffect, useState } from 'react'
import { Plug, ChevronDown, CircleAlert } from 'lucide-react'
import { useActiveMindmapInstance } from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { useWorkspaceStore } from '@/features/workspace/store'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { ShortcutsList } from '@/shared/shortcuts/ShortcutsList'
import type { MindLaneFile } from '@/shared/lib/fileFormat'

type SettingsSectionId = 'about' | 'workspace' | 'ai' | 'editor' | 'integrations'

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; description: string }[] = [
  { id: 'about', label: '关于', description: '版本与基础信息' },
  { id: 'workspace', label: '文件与工作区', description: '仓库与文档行为' },
  { id: 'ai', label: 'AI 配置', description: '模型与密钥' },
  { id: 'integrations', label: '集成', description: '外部服务连接' },
  { id: 'editor', label: '编辑器', description: '保存与快捷键' },
]

const AUTO_SAVE_OPTIONS = [
  { value: 5_000, label: '5 秒' },
  { value: 10_000, label: '10 秒' },
  { value: 30_000, label: '30 秒' },
  { value: 60_000, label: '1 分钟' },
]

type McpServerStatusInfo = Extract<
  Awaited<ReturnType<NonNullable<typeof window.mindlane>['settings']['mcpStatus']>>,
  { ok: true }
>['data'][number]

const MCP_STATE_LABELS: Record<McpServerStatusInfo['state'], string> = {
  disconnected: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  failed: '连接失败',
}

// Brand icons live in public/assets, keyed by server id; unknown ids fall back to a generic plug icon.
const MCP_ICONS: Record<string, string> = {
  notion: '/assets/notion.svg',
  obsidian: '/assets/obsidian.svg',
  feishu: '/assets/feishu.svg',
}

/** 各 MCP 的简短连接教程：steps 每行一步，悬浮感叹号气泡展示；链接走 shell.openExternal */
const MCP_TUTORIAL: Record<
  string,
  { steps: string[]; links: { label: string; url: string }[] }
> = {
  obsidian: {
    steps: [
      '插件仓库：github.com/coddingtonbear/obsidian-local-rest-api（自带 MCP 服务）',
      'Obsidian → 设置 → 第三方插件：安装并启用 “Local REST API with MCP”',
      '在插件设置中开启加密端口（HTTPS 27124）',
      '把插件里的 API Key 粘贴到表单，确认连接',
    ],
    links: [{ label: '打开插件仓库', url: 'https://github.com/coddingtonbear/obsidian-local-rest-api' }],
  },
  feishu: {
    steps: [
      '在开放平台创建自建应用，开通文档搜索/读取/wiki 权限',
      '「安全设置 → 重定向 URL」登记 http://127.0.0.1:44664/callback',
      '填入 App ID / App Secret；▾ 展开可用一键获取 UAT',
      '确认连接后，AI 即可搜索并读取你的云文档',
    ],
    links: [
      { label: '接入教程', url: 'https://open.feishu.cn/document/mcp_open_tools/developers-call-remote-mcp-server' },
      { label: '获取 UAT', url: 'https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3' },
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

  /** 打开配置表单并回填已保存的凭据（只回填本 server 声明的字段） */
  const openFormPrefilled = async (server: McpServerStatusInfo) => {
    let secrets: Record<string, string> = {}
    try {
      const res = await window.mindlane?.settings.mcpGetCredentials(server.id)
      if (res?.ok) secrets = res.data
    } catch {
      // 主进程尚未注册该 handler（如重载后未重启主进程）时降级为空表单，不阻断编辑
      secrets = {}
    }
    const ids = new Set((server.credentialFields ?? []).map((f) => f.id))
    const prefilled: Record<string, string> = {}
    for (const [k, v] of Object.entries(secrets)) if (ids.has(k)) prefilled[k] = v
    setFormValues(prefilled)
    setFormError(null)
    setFormOpenId(server.id)
  }

  /** 显示配置 toggle：开→关，关→开（打开时回填已保存凭据） */
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
        setFormError(res?.error ?? '连接失败')
      }
    } finally {
      await refresh()
      setBusyId(null)
    }
  }

  /** 一键获取飞书 UAT：打开授权页，成功后回填 uat 字段 */
  const acquireUat = async (server: McpServerStatusInfo) => {
    const appId = (formValues['appId'] ?? '').trim()
    const appSecret = (formValues['appSecret'] ?? '').trim()
    if (!appId || !appSecret) {
      setFormError('请先填写 App ID 与 App Secret 再获取 UAT')
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
        setFormError('UAT 获取成功，已自动填入；请点击“确认连接”')
      } else {
        setFormError(res?.error ?? '获取 UAT 失败')
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
                className={`panel-btn${connected ? '' : ' panel-btn--primary'}`}
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
                {busy ? '处理中…' : connected ? '断开' : formOpen ? '取消' : '连接'}
              </button>
              {hasForm && (
                <button
                  type="button"
                  className="panel-btn"
                  disabled={busy}
                  aria-expanded={formOpen}
                  aria-label="配置"
                  title={formOpen ? '收起配置' : '显示配置'}
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
                          className="panel-btn"
                          disabled={busyUat}
                          onClick={() => void acquireUat(server)}
                        >
                          {busyUat ? '获取中…' : '一键获取'}
                        </button>
                      )}
                    </span>
                  </label>
                ))}
                {formError && <div className="mcp-server__form-error">{formError}</div>}
                <button
                  type="button"
                  className="panel-btn panel-btn--primary"
                  disabled={busy || busyUat}
                  onClick={() => void submitForm(server)}
                >
                  确认连接
                </button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('about')
  const apiKey = useSettingsStore((s) => s.apiKey)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const chatModel = useSettingsStore((s) => s.chatModel)
  const setChatModel = useSettingsStore((s) => s.setChatModel)
  const capabilities = useSettingsStore((s) => s.capabilities)
  const autoSaveIntervalMs = useSettingsStore((s) => s.autoSaveIntervalMs)
  const setAutoSaveIntervalMs = useSettingsStore((s) => s.setAutoSaveIntervalMs)
  const providers = useSettingsStore((s) => s.providers)
  const activeChatProvider = useSettingsStore((s) => s.activeChatProvider)
  const setActiveChatProvider = useSettingsStore((s) => s.setActiveChatProvider)
  const activeInstance = useActiveMindmapInstance()
  const restoreLastWorkspaceOnLaunch = useWorkspaceStore((s) => s.restoreLastWorkspaceOnLaunch)
  const setRestoreLastWorkspaceOnLaunch = useWorkspaceStore(
    (s) => s.setRestoreLastWorkspaceOnLaunch,
  )
  const openWorkspaceDirectory = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const syncAfterFileSaved = useWorkspaceStore((s) => s.syncAfterFileSaved)

  const activeProvider = providers.find((p) => p.id === activeChatProvider) ?? providers[0]
  const models = activeProvider?.models ?? []
  const chatEnabled = capabilities.includes('chat')
  const visionEnabled = capabilities.includes('vision')
  const imageGenEnabled = capabilities.includes('imageGen')

  return (
    <div className="settings-page">
      <aside className="settings-page__sidebar">
        <nav className="settings-page__nav" aria-label="设置分类">
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
          <section
            className={`settings-card${activeSection === 'about' ? '' : ' settings-card--hidden'}`}
          >
            <div className="settings-card__title">关于应用</div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">当前版本</div>
                <div className="settings-card__value">0.0.0</div>
                <div className="settings-card__hint">当前为桌面应用预览版本。</div>
              </div>
              <button type="button" className="panel-btn panel-btn--primary">
                检查更新
              </button>
            </div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">工作区状态</div>
                <div className="settings-card__value">
                  {workspacePath ? '已打开工作区' : '未打开工作区'}
                </div>
                <div className="settings-card__hint">{workspacePath ?? '尚未选择本地仓库'}</div>
              </div>
            </div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">排障日志</div>
                <div className="settings-card__hint">
                  遇到问题时打开日志目录，把日志文件发给开发者。
                </div>
              </div>
              <button
                type="button"
                className="panel-btn"
                onClick={() => void window.mindlane?.shell.openLogs()}
              >
                打开日志目录
              </button>
            </div>
          </section>

          <section
            className={`settings-card${activeSection === 'workspace' ? '' : ' settings-card--hidden'}`}
          >
            <div className="settings-card__title">文件与工作区</div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">当前仓库</div>
                <div className="settings-card__value">{workspacePath ?? '未打开本地仓库'}</div>
                <div className="settings-card__hint">切换仓库时会优先自动保存当前编辑内容。</div>
              </div>
              <button
                type="button"
                className="panel-btn panel-btn--primary"
                onClick={() => void openWorkspaceDirectory()}
              >
                切换仓库
              </button>
            </div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">启动恢复</div>
                <div className="settings-card__value">打开上次工作区与文件</div>
                <div className="settings-card__hint">重新启动应用时恢复上一次工作上下文。</div>
              </div>
              <label className="settings-card__switch">
                <input
                  type="checkbox"
                  checked={restoreLastWorkspaceOnLaunch}
                  onChange={(e) => void setRestoreLastWorkspaceOnLaunch(e.target.checked)}
                />
                <span>{restoreLastWorkspaceOnLaunch ? '开启' : '关闭'}</span>
              </label>
            </div>
            <div className="settings-card__action-group">
              <button
                type="button"
                className="panel-btn"
                onClick={async () => {
                  const result = await window.mindlane?.file.open()
                  if (result?.ok) {
                    const instance = mindmapRegistry.getOrCreate(result.data.filePath)
                    instance.load(result.data.filePath, result.data.data as MindLaneFile, null)
                    mindmapRegistry.setActive(result.data.filePath)
                    await syncAfterFileSaved(result.data.filePath)
                  }
                }}
              >
                打开文件
              </button>
              <button
                type="button"
                className="panel-btn"
                onClick={async () => {
                  const state = activeInstance.store.getState()
                  const data = state.toMindLaneFile()
                  const result = await window.mindlane?.file.save({
                    filePath: state.filePath,
                    data,
                  })
                  if (result?.ok) {
                    state.setFilePath(result.data.filePath)
                    state.markClean()
                    await syncAfterFileSaved(result.data.filePath)
                  }
                }}
              >
                立即保存
              </button>
              <button
                type="button"
                className="panel-btn"
                onClick={async () => {
                  const state = activeInstance.store.getState()
                  const data = state.toMindLaneFile()
                  const result = await window.mindlane?.file.saveAs({ data })
                  if (result?.ok) {
                    const instance = mindmapRegistry.getOrCreate(result.data.filePath)
                    instance.load(
                      result.data.filePath,
                      result.data.data as MindLaneFile,
                      workspacePath,
                    )
                    mindmapRegistry.setActive(result.data.filePath)
                    await syncAfterFileSaved(result.data.filePath)
                  }
                }}
              >
                另存为
              </button>
            </div>
          </section>

          <section
            className={`settings-card${activeSection === 'ai' ? '' : ' settings-card--hidden'}`}
          >
            <div className="settings-card__title">AI 配置</div>
            {providers.length > 1 && (
              <div className="panel-field">
                <label className="panel-field__label" htmlFor="settings-provider">
                  AI 服务商
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
                placeholder={`输入 ${activeProvider?.displayName ?? 'API'} Key`}
              />
            </div>
            <div className="panel-field">
              <label className="panel-field__label" htmlFor="settings-model">
                模型
              </label>
              <select
                id="settings-model"
                className="panel-field__select"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
              >
                <option value="" disabled>
                  请选择模型
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
            {activeProvider && (
              <div className="settings-card__hint">
                {activeProvider.displayName} 支持的功能：
                {chatEnabled && ' 对话'}
                {visionEnabled && ' 视觉理解'}
                {imageGenEnabled && ' 文生图'}
                {imageGenEnabled && !visionEnabled && ' | 可文生图，但记忆宫殿不可用'}
                {!imageGenEnabled && ' | 文生图不可用'}
              </div>
            )}
          </section>

          <section
            className={`settings-card${activeSection === 'integrations' ? '' : ' settings-card--hidden'}`}
          >
            <div className="settings-card__title">集成</div>
            <McpIntegrationsSection />
          </section>

          <section
            className={`settings-card${activeSection === 'editor' ? '' : ' settings-card--hidden'}`}
          >
            <div className="settings-card__title">编辑器</div>
            <div className="settings-card__row">
              <div>
                <div className="settings-card__label">自动保存</div>
                <div className="settings-card__hint">仅对已经有真实文件路径的文档生效。</div>
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
                <div className="settings-card__label">快捷键说明</div>
                <div className="settings-card__hint">所有导图与应用级快捷键直接展示在这里。</div>
              </div>
            </div>
            <div className="shortcuts-inline">
              <ShortcutsList />
            </div>
            <div className="settings-card__hint">
              未保存草稿在切换仓库或打开其他文件时会优先自动保存，不再反复打断操作。
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
