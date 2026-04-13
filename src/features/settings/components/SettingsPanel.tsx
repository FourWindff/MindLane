import { useMemo, useState } from 'react'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { ShortcutsList } from '@/shared/shortcuts'
import type { MindLaneFile } from '@/shared/lib/fileFormat'

type SettingsSectionId = 'about' | 'workspace' | 'ai' | 'editor'

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; description: string }[] = [
  { id: 'about', label: '关于', description: '版本与基础信息' },
  { id: 'workspace', label: '文件与工作区', description: '仓库与文档行为' },
  { id: 'ai', label: 'AI 配置', description: '模型与密钥' },
  { id: 'editor', label: '编辑器', description: '保存与快捷键' },
]

const AUTO_SAVE_OPTIONS = [
  { value: 5_000, label: '5 秒' },
  { value: 10_000, label: '10 秒' },
  { value: 30_000, label: '30 秒' },
  { value: 60_000, label: '1 分钟' },
]

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('about')
  const apiKey = useSettingsStore((s) => s.apiKey)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const chatModel = useSettingsStore((s) => s.chatModel)
  const setChatModel = useSettingsStore((s) => s.setChatModel)
  const autoSaveIntervalMs = useSettingsStore((s) => s.autoSaveIntervalMs)
  const setAutoSaveIntervalMs = useSettingsStore((s) => s.setAutoSaveIntervalMs)
  const providers = useSettingsStore((s) => s.providers)
  const activeChatProvider = useSettingsStore((s) => s.activeChatProvider)
  const setActiveChatProvider = useSettingsStore((s) => s.setActiveChatProvider)
  const currentFilePath = useMindmapStore((s) => s.filePath)
  const restoreLastWorkspaceOnLaunch = useWorkspaceStore((s) => s.restoreLastWorkspaceOnLaunch)
  const setRestoreLastWorkspaceOnLaunch = useWorkspaceStore((s) => s.setRestoreLastWorkspaceOnLaunch)
  const openWorkspaceDirectory = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const syncAfterFileSaved = useWorkspaceStore((s) => s.syncAfterFileSaved)

  const activeProvider = providers.find((p) => p.id === activeChatProvider) ?? providers[0]
  const models = activeProvider?.models ?? []
  const activeSectionMeta = useMemo(
    () => SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0],
    [activeSection],
  )

  return (
    <div className="settings-page">
      <aside className="settings-page__sidebar">
        <div className="settings-page__sidebar-title">设置</div>
        <div className="settings-page__sidebar-subtitle">MindLane</div>
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
        <header className="settings-page__header">
          <div>
            <div className="settings-page__eyebrow">MindLane 设置</div>
            <h2 className="settings-page__title">{activeSectionMeta.label}</h2>
            <p className="settings-page__description">{activeSectionMeta.description}</p>
          </div>
        </header>

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
                <div className="settings-card__value">{workspacePath ? '已打开工作区' : '未打开工作区'}</div>
                <div className="settings-card__hint">{workspacePath ?? '尚未选择本地仓库'}</div>
              </div>
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
                    useMindmapStore.getState().loadFile(
                      result.data.filePath,
                      result.data.data as MindLaneFile,
                    )
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
                  const state = useMindmapStore.getState()
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
                  const data = useMindmapStore.getState().toMindLaneFile()
                  const result = await window.mindlane?.file.saveAs({ data })
                  if (result?.ok) {
                    const state = useMindmapStore.getState()
                    state.setFilePath(result.data.filePath)
                    state.markClean()
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
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
            {activeProvider && activeProvider.capabilities && (
              <div className="settings-card__hint">
                {activeProvider.displayName} 支持的功能：
                {activeProvider.capabilities.includes('chat') && ' 对话'}
                {activeProvider.capabilities.includes('vision') && ' 视觉理解'}
                {activeProvider.capabilities.includes('imageGen') && ' 文生图'}
                {activeProvider.capabilities.includes('embeddings') && ' 知识库检索'}
                {!activeProvider.capabilities.includes('imageGen') && ' | 记忆宫殿不可用'}
                {!activeProvider.capabilities.includes('embeddings') && ' | 知识库不可用'}
              </div>
            )}
            <div className="settings-card__hint">
              当前文件：{currentFilePath ?? '未绑定文件'}，AI 流程会优先使用这里配置的模型。
            </div>
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
                <div className="settings-card__hint">
                  所有导图与应用级快捷键直接展示在这里。
                </div>
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
