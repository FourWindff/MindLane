import { useState } from 'react'
import { Palette, Brush } from 'lucide-react'
import { useStyleStore } from '@/features/mindmap/style/styleStore'
import { MAP_STYLES, COLOR_SCHEMES } from '@/features/mindmap/style/presets'
import type { MapStyleId, ColorSchemeId } from '@/features/mindmap/style/types'

type Tab = 'style' | 'color'

export function StylePanel({ onClose }: { onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('style')

  const mapStyle    = useStyleStore((s) => s.mapStyle)
  const colorScheme = useStyleStore((s) => s.colorScheme)
  const setMapStyle    = useStyleStore((s) => s.setMapStyle)
  const setColorScheme = useStyleStore((s) => s.setColorScheme)

  const logicStyles   = MAP_STYLES.filter((s) => s.structureType === 'logic')
  const mindmapStyles = MAP_STYLES.filter((s) => s.structureType === 'mindmap')

  return (
    <div className="style-panel" role="dialog" aria-label="导图样式">
      <div className="style-panel__header">
        <span className="style-panel__title">导图样式</span>
        {onClose && (
          <button
            className="style-panel__close"
            onClick={onClose}
            aria-label="关闭样式面板"
          >
            ✕
          </button>
        )}
      </div>

      {/* 标签切换：只有风格 + 配色两个 tab */}
      <div className="style-panel__tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'style'}
          className={`style-panel__tab ${activeTab === 'style' ? 'style-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('style')}
        >
          <Brush size={14} />
          风格
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'color'}
          className={`style-panel__tab ${activeTab === 'color' ? 'style-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('color')}
        >
          <Palette size={14} />
          配色
        </button>
      </div>

      {/* ── 风格面板 ── */}
      {activeTab === 'style' && (
        <div className="style-panel__section">
          {/* 逻辑图分组 */}
          <div className="style-panel__group-label">逻辑图</div>
          <div className="style-panel__style-grid">
            {logicStyles.map((ms) => (
              <button
                key={ms.id}
                className={`style-panel__style-option ${mapStyle === ms.id ? 'style-panel__style-option--active' : ''}`}
                onClick={() => setMapStyle(ms.id as MapStyleId)}
                title={ms.description}
              >
                <LogicPreview variant={ms.visualVariant} active={mapStyle === ms.id} />
                <span className="style-panel__style-label">{ms.label}</span>
              </button>
            ))}
          </div>

          {/* 思维导图分组 */}
          <div className="style-panel__group-label" style={{ marginTop: 12 }}>思维导图</div>
          <div className="style-panel__style-grid">
            {mindmapStyles.map((ms) => (
              <button
                key={ms.id}
                className={`style-panel__style-option ${mapStyle === ms.id ? 'style-panel__style-option--active' : ''}`}
                onClick={() => setMapStyle(ms.id as MapStyleId)}
                title={ms.description}
              >
                <MindmapPreview variant={ms.visualVariant} active={mapStyle === ms.id} />
                <span className="style-panel__style-label">{ms.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 配色方案 ── */}
      {activeTab === 'color' && (
        <div className="style-panel__section style-panel__section--colors">
          {COLOR_SCHEMES.map((cs) => (
            <button
              key={cs.id}
              className={`style-panel__swatch ${colorScheme === cs.id ? 'style-panel__swatch--active' : ''}`}
              onClick={() => setColorScheme(cs.id as ColorSchemeId)}
              aria-label={cs.label}
              title={cs.label}
            >
              <span
                className="style-panel__swatch-color"
                style={{ background: cs.swatch }}
              />
              <span className="style-panel__swatch-label">{cs.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 逻辑图微缩预览 SVG ────────────────────────────────────────────────────────

function LogicPreview({
  variant,
  active,
}: {
  variant: 'card' | 'outline' | 'minimal'
  active: boolean
}) {
  const color = active ? 'var(--ml-accent)' : 'var(--ml-text-muted)'
  const fill  = active ? 'var(--ml-accent-soft)' : 'rgba(0,0,0,0.06)'

  if (variant === 'card') {
    return (
      <svg className="style-panel__preview" viewBox="0 0 54 36" fill="none">
        {/* 根节点 */}
        <rect x="2"  y="13" width="16" height="10" rx="2.5" fill={fill} stroke={color} strokeWidth="1.3" />
        {/* 子节点 */}
        <rect x="28" y="4"  width="22" height="8"  rx="2" fill={fill} stroke={color} strokeWidth="1" />
        <rect x="28" y="14" width="22" height="8"  rx="2" fill={fill} stroke={color} strokeWidth="1" />
        <rect x="28" y="24" width="22" height="8"  rx="2" fill={fill} stroke={color} strokeWidth="1" />
        {/* 贝塞尔边 */}
        <path d="M18 18 C22 18 24 8 28 8"   stroke={color} strokeWidth="1" fill="none" />
        <path d="M18 18 C22 18 24 18 28 18"  stroke={color} strokeWidth="1" fill="none" />
        <path d="M18 18 C22 18 24 28 28 28"  stroke={color} strokeWidth="1" fill="none" />
      </svg>
    )
  }
  if (variant === 'outline') {
    return (
      <svg className="style-panel__preview" viewBox="0 0 54 36" fill="none">
        <rect x="2"  y="13" width="16" height="10" rx="1.5" stroke={color} strokeWidth="1.3" />
        <rect x="28" y="4"  width="22" height="8"  rx="1" stroke={color} strokeWidth="1" />
        <rect x="28" y="14" width="22" height="8"  rx="1" stroke={color} strokeWidth="1" />
        <rect x="28" y="24" width="22" height="8"  rx="1" stroke={color} strokeWidth="1" />
        {/* smooth-step 折线 */}
        <path d="M18 18 L22 18 L22 8  L28 8"  stroke={color} strokeWidth="1" fill="none" />
        <path d="M22 18 L28 18"               stroke={color} strokeWidth="1" fill="none" />
        <path d="M22 18 L22 28 L28 28"        stroke={color} strokeWidth="1" fill="none" />
      </svg>
    )
  }
  // minimal
  return (
    <svg className="style-panel__preview" viewBox="0 0 54 36" fill="none">
      <line x1="2"  y1="19.5" x2="18" y2="19.5" stroke={color} strokeWidth="1.5" />
      <line x1="28" y1="8.5"  x2="50" y2="8.5"  stroke={color} strokeWidth="1.2" />
      <line x1="28" y1="18.5" x2="50" y2="18.5" stroke={color} strokeWidth="1.2" />
      <line x1="28" y1="28.5" x2="50" y2="28.5" stroke={color} strokeWidth="1.2" />
      {/* 直角折线 */}
      <path d="M18 18 L22 18 L22 8  L28 8"  stroke={color} strokeWidth="1" fill="none" />
      <path d="M22 18 L28 18"               stroke={color} strokeWidth="1" fill="none" />
      <path d="M22 18 L22 28 L28 28"        stroke={color} strokeWidth="1" fill="none" />
    </svg>
  )
}

// ─── 思维导图微缩预览 SVG ──────────────────────────────────────────────────────

function MindmapPreview({
  variant,
  active,
}: {
  variant: 'card' | 'outline' | 'minimal'
  active: boolean
}) {
  const color = active ? 'var(--ml-accent)' : 'var(--ml-text-muted)'
  const fill  = active ? 'var(--ml-accent-soft)' : 'rgba(0,0,0,0.06)'

  if (variant === 'card') {
    return (
      <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
        {/* 中心根节点 */}
        <rect x="22" y="13" width="20" height="10" rx="2.5" fill={fill} stroke={color} strokeWidth="1.3" />
        {/* 右侧子节点 */}
        <rect x="47" y="4"  width="15" height="7" rx="1.5" fill={fill} stroke={color} strokeWidth="1" />
        <rect x="47" y="25" width="15" height="7" rx="1.5" fill={fill} stroke={color} strokeWidth="1" />
        {/* 左侧子节点 */}
        <rect x="2"  y="4"  width="15" height="7" rx="1.5" fill={fill} stroke={color} strokeWidth="1" />
        <rect x="2"  y="25" width="15" height="7" rx="1.5" fill={fill} stroke={color} strokeWidth="1" />
        {/* 边 */}
        <path d="M42 18 C44 18 45 7.5 47 7.5"  stroke={color} strokeWidth="1" fill="none" />
        <path d="M42 18 C44 18 45 28.5 47 28.5" stroke={color} strokeWidth="1" fill="none" />
        <path d="M22 18 C20 18 19 7.5 17 7.5"  stroke={color} strokeWidth="1" fill="none" />
        <path d="M22 18 C20 18 19 28.5 17 28.5" stroke={color} strokeWidth="1" fill="none" />
      </svg>
    )
  }
  if (variant === 'outline') {
    return (
      <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
        <rect x="22" y="13" width="20" height="10" rx="1.5" stroke={color} strokeWidth="1.3" />
        <rect x="47" y="4"  width="15" height="7" rx="1" stroke={color} strokeWidth="1" />
        <rect x="47" y="25" width="15" height="7" rx="1" stroke={color} strokeWidth="1" />
        <rect x="2"  y="4"  width="15" height="7" rx="1" stroke={color} strokeWidth="1" />
        <rect x="2"  y="25" width="15" height="7" rx="1" stroke={color} strokeWidth="1" />
        <path d="M42 18 L44 18 L44 7.5  L47 7.5"  stroke={color} strokeWidth="1" fill="none" />
        <path d="M44 18 L44 28.5 L47 28.5"        stroke={color} strokeWidth="1" fill="none" />
        <path d="M22 18 L20 18 L20 7.5  L17 7.5"  stroke={color} strokeWidth="1" fill="none" />
        <path d="M20 18 L20 28.5 L17 28.5"        stroke={color} strokeWidth="1" fill="none" />
      </svg>
    )
  }
  // minimal
  return (
    <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
      <line x1="22" y1="19.5" x2="42" y2="19.5" stroke={color} strokeWidth="1.5" />
      <line x1="47" y1="8.5"  x2="62" y2="8.5"  stroke={color} strokeWidth="1.2" />
      <line x1="47" y1="28.5" x2="62" y2="28.5" stroke={color} strokeWidth="1.2" />
      <line x1="2"  y1="8.5"  x2="17" y2="8.5"  stroke={color} strokeWidth="1.2" />
      <line x1="2"  y1="28.5" x2="17" y2="28.5" stroke={color} strokeWidth="1.2" />
      <path d="M42 18 L44 18 L44 8.5  L47 8.5"  stroke={color} strokeWidth="1" fill="none" />
      <path d="M44 18 L44 28.5 L47 28.5"        stroke={color} strokeWidth="1" fill="none" />
      <path d="M22 18 L20 18 L20 8.5  L17 8.5"  stroke={color} strokeWidth="1" fill="none" />
      <path d="M20 18 L20 28.5 L17 28.5"        stroke={color} strokeWidth="1" fill="none" />
    </svg>
  )
}
