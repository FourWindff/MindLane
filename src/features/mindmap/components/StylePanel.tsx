import { useState } from 'react'
import { Palette, Brush } from 'lucide-react'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { STRUCTURE_TYPES, VISUAL_VARIANTS, COLOR_SCHEMES } from '@/features/mindmap/style/presets'
import { SCHEME_PALETTES } from '@/features/mindmap/style/colorPalettes'
import type { ColorSchemeId, StructureType, VisualVariant } from '@/features/mindmap/style/types'

type Tab = 'style' | 'color'

export function StylePanel({
  onClose,
  initialTab = 'style',
}: {
  onClose?: () => void
  initialTab?: Tab
}) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)

  const style = useActiveMindmapStore((s) => s.style)
  const setStyle = useActiveMindmapStore((s) => s.setStyle)
  const { structureType, visualVariant, colorScheme } = style

  return (
    <div className="style-panel" role="dialog" aria-label="导图样式">
      <div className="style-panel__header">
        <span className="style-panel__title">导图样式</span>
        {onClose && (
          <button className="style-panel__close" onClick={onClose} aria-label="关闭样式面板">
            ✕
          </button>
        )}
      </div>

      {/* 标签切换：风格 + 配色两个 tab */}
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

      {/* ── 风格面板：结构轴 + 视觉轴独立选择 ── */}
      {activeTab === 'style' && (
        <div className="style-panel__section">
          <div className="style-panel__group-label">结构</div>
          <div className="style-panel__style-grid">
            {STRUCTURE_TYPES.map((s) => (
              <button
                key={s.id}
                className={`style-panel__style-option ${structureType === s.id ? 'style-panel__style-option--active' : ''}`}
                onClick={() => setStyle({ structureType: s.id as StructureType })}
                title={s.description}
              >
                <StructurePreview id={s.id as StructureType} active={structureType === s.id} />
                <span className="style-panel__style-label">{s.label}</span>
              </button>
            ))}
          </div>

          <div className="style-panel__group-label" style={{ marginTop: 12 }}>
            视觉样式
          </div>
          <div className="style-panel__style-grid">
            {Object.values(VISUAL_VARIANTS).map((v) => (
              <button
                key={v.id}
                className={`style-panel__style-option ${visualVariant === v.id ? 'style-panel__style-option--active' : ''}`}
                onClick={() => setStyle({ visualVariant: v.id as VisualVariant })}
                title={v.description}
              >
                <VariantPreview variant={v.id as VisualVariant} active={visualVariant === v.id} />
                <span className="style-panel__style-label">{v.label}</span>
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
              className={`style-panel__color-option ${colorScheme === cs.id ? 'style-panel__color-option--active' : ''}`}
              onClick={() => setStyle({ colorScheme: cs.id as ColorSchemeId })}
              aria-label={cs.label}
              title={cs.label}
            >
              <span className="style-panel__color-label">{cs.label}</span>
              <ColorSwatch schemeId={cs.id as ColorSchemeId} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ColorSwatch({ schemeId }: { schemeId: ColorSchemeId }) {
  const palette = SCHEME_PALETTES[schemeId]

  return (
    <span className="style-panel__swatch">
      {palette.branches.map((branch, i) => (
        <span
          key={i}
          className="style-panel__swatch-bar"
          style={{ background: branch.depth1.nodeBg }}
        />
      ))}
    </span>
  )
}

// ─── 结构轴预览：只展示树形状（单向 vs 双向） ────────────────────────────────

function StructurePreview({ id, active }: { id: StructureType; active: boolean }) {
  const color = active ? 'var(--ml-accent)' : 'var(--ml-text-muted)'
  const fill = active ? 'var(--ml-accent-soft)' : 'rgba(0,0,0,0.06)'

  if (id === 'mindmap') {
    return (
      <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
        <rect
          x="24"
          y="13"
          width="16"
          height="10"
          rx="2"
          fill={fill}
          stroke={color}
          strokeWidth="1.3"
        />
        <rect
          x="2"
          y="5"
          width="13"
          height="7"
          rx="1.5"
          fill={fill}
          stroke={color}
          strokeWidth="1"
        />
        <rect
          x="2"
          y="24"
          width="13"
          height="7"
          rx="1.5"
          fill={fill}
          stroke={color}
          strokeWidth="1"
        />
        <rect
          x="49"
          y="5"
          width="13"
          height="7"
          rx="1.5"
          fill={fill}
          stroke={color}
          strokeWidth="1"
        />
        <rect
          x="49"
          y="24"
          width="13"
          height="7"
          rx="1.5"
          fill={fill}
          stroke={color}
          strokeWidth="1"
        />
        <path d="M24 18 L15 8.5 L15 8.5 L15 8.5" stroke={color} strokeWidth="1" fill="none" />
        <path d="M24 18 L15 18 L15 27.5 L15 27.5" stroke={color} strokeWidth="1" fill="none" />
        <path d="M40 18 L49 8.5" stroke={color} strokeWidth="1" fill="none" />
        <path d="M40 18 L49 27.5" stroke={color} strokeWidth="1" fill="none" />
      </svg>
    )
  }
  // logic：单向展开
  return (
    <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
      <rect
        x="2"
        y="13"
        width="16"
        height="10"
        rx="2"
        fill={fill}
        stroke={color}
        strokeWidth="1.3"
      />
      <rect
        x="30"
        y="3"
        width="14"
        height="7"
        rx="1.5"
        fill={fill}
        stroke={color}
        strokeWidth="1"
      />
      <rect
        x="30"
        y="15"
        width="14"
        height="7"
        rx="1.5"
        fill={fill}
        stroke={color}
        strokeWidth="1"
      />
      <rect
        x="30"
        y="27"
        width="14"
        height="7"
        rx="1.5"
        fill={fill}
        stroke={color}
        strokeWidth="1"
      />
      <path d="M18 18 L30 6.5" stroke={color} strokeWidth="1" fill="none" />
      <path d="M18 18 L30 18.5" stroke={color} strokeWidth="1" fill="none" />
      <path d="M18 18 L30 30.5" stroke={color} strokeWidth="1" fill="none" />
    </svg>
  )
}

// ─── 视觉轴预览：只展示节点样式 + 边样式与连接方式 ──────────────────────────

function VariantPreview({ variant, active }: { variant: VisualVariant; active: boolean }) {
  const color = active ? 'var(--ml-accent)' : 'var(--ml-text-muted)'
  const fill = active ? 'var(--ml-accent-soft)' : 'rgba(0,0,0,0.06)'

  if (variant === 'card') {
    return (
      <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
        <rect
          x="2"
          y="13"
          width="18"
          height="10"
          rx="3"
          fill={fill}
          stroke={color}
          strokeWidth="1.3"
        />
        <rect
          x="42"
          y="13"
          width="18"
          height="10"
          rx="3"
          fill={fill}
          stroke={color}
          strokeWidth="1"
        />
        {/* 树干渐变：源端粗、末端细的填充形状 */}
        <path d="M20 16.5 L28 16 L36 17.3 L36 18.7 L28 19 L20 18.5 Z" fill={color} />
      </svg>
    )
  }
  if (variant === 'outline') {
    return (
      <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
        <rect x="2" y="13" width="18" height="10" rx="2" stroke={color} strokeWidth="1.3" />
        <rect x="42" y="13" width="18" height="10" rx="2" stroke={color} strokeWidth="1" />
        {/* smooth-step 折线，连接侧边中点 */}
        <path d="M20 18 L27 18 L27 18 L34 18" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    )
  }
  // minimal：下划线节点 + 直角折线连接下边框
  return (
    <svg className="style-panel__preview" viewBox="0 0 64 36" fill="none">
      <line x1="2" y1="18" x2="20" y2="18" stroke={color} strokeWidth="1.5" />
      <line x1="42" y1="18" x2="62" y2="18" stroke={color} strokeWidth="1.5" />
      {/* 边从根节点底部出发，横向连接后进入子节点底部 */}
      <path d="M11 18 L11 23 L51.5 23 L51.5 18" stroke={color} strokeWidth="1.2" fill="none" />
    </svg>
  )
}
