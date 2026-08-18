import { useState } from 'react'
import { Ban, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import type { ChatToolCall, ChatToolCallStep } from '@/shared/lib/fileFormat'
import { toolDisplayName } from '@/features/chat/lib/chatUtils'

export type ToolCardStatus = NonNullable<ChatToolCall['status']>

/** 归一化卡片：流式（ToolCard）与历史（ChatToolCall）共用同一渲染规则。 */
export interface ToolCardItem {
  name: string
  status?: ToolCardStatus
  /** 流式子图阶段（实时，来自 step 事件透传的计数）。 */
  step?: string
  completed?: number
  total?: number
  /** 历史子图阶段轨迹（持久化，ChatToolCall.steps）。 */
  steps?: ChatToolCallStep[]
}

/**
 * 仅思维导图子图卡片（generateMindmapFragment）有阶段进度、可展开；
 * palace 子图无阶段事件、写/读工具卡片保持单行。
 */
function isSubgraphCard(name: string): boolean {
  return name === 'generateMindmapFragment'
}

const STAGE_LABELS: Record<string, string> = {
  'reading-doc': '读取文档',
  extracting: '提取要点',
  merging: '合并',
  finalizing: '定稿',
}

function stageDisplayName(step: string, completed?: number, total?: number): string {
  const label = STAGE_LABELS[step] ?? step
  return typeof completed === 'number' && typeof total === 'number'
    ? `${label} ${completed}/${total}`
    : label
}

function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

/**
 * 工具卡片区：AI 气泡上方的独立区域，一个工具调用一行、左对齐。
 * 流式进行中与历史消息走同一组件；历史卡片无 status（旧会话）时推断为已结束（✓）。
 * 子图卡片运行中默认展开显示逐阶段进度，完成后自动折叠，支持手动展开/收起。
 */
export function ToolCardList({ cards }: { cards: ToolCardItem[] }) {
  return (
    <div className="chat-message-list__tool-cards" aria-label="工具调用记录">
      {cards.map((card, i) => (
        <ToolCardRow
          key={`${card.name}-${i}`}
          card={{ ...card, status: card.status ?? 'success' }}
        />
      ))}
    </div>
  )
}

function ToolCardRow({ card }: { card: ToolCardItem & { status: ToolCardStatus } }) {
  const stages =
    card.steps ??
    (card.step ? [{ step: card.step, completed: card.completed, total: card.total }] : undefined)
  if (!isSubgraphCard(card.name) || !stages || stages.length === 0) {
    return <SingleLineCard card={card} />
  }
  return <SubgraphCard card={card} stages={stages} />
}

function StatusGlyph({ status }: { status: ToolCardStatus }) {
  switch (status) {
    case 'running':
      return <span className="chat-message-list__spinner" aria-hidden="true" />
    case 'success':
      return <Check size={11} strokeWidth={2} aria-hidden="true" />
    case 'error':
      return <X size={11} strokeWidth={2} aria-hidden="true" />
    case 'canceled':
      return <Ban size={11} strokeWidth={2} aria-hidden="true" />
  }
}

function CardClassName(status: ToolCardStatus, extra?: string): string {
  return cx(
    'chat-message-list__tool-card',
    `chat-message-list__tool-card--${status}`,
    status === 'running' && 'chat-message-list__tool-card--active',
    extra,
  )
}

function SingleLineCard({ card }: { card: ToolCardItem & { status: ToolCardStatus } }) {
  return (
    <span className={CardClassName(card.status)}>
      <StatusGlyph status={card.status} />
      <span className="chat-message-list__tool-card__name">{toolDisplayName(card.name)}</span>
      {card.status === 'canceled' && (
        <span className="chat-message-list__tool-card__mark">取消</span>
      )}
    </span>
  )
}

function SubgraphCard({
  card,
  stages,
}: {
  card: ToolCardItem & { status: ToolCardStatus }
  stages: Array<{ step: string; completed?: number; total?: number }>
}) {
  // 手动展开/收起：null 跟随默认（运行中展开、完成后折叠）。
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const showBody = expanded ?? card.status === 'running'
  return (
    <div className={CardClassName(card.status, 'chat-message-list__tool-card--subgraph')}>
      <button
        type="button"
        className="chat-message-list__tool-card__toggle"
        onClick={() => setExpanded(!showBody)}
        aria-expanded={showBody}
        aria-label={`${toolDisplayName(card.name)} ${showBody ? '收起' : '展开'}`}
      >
        <StatusGlyph status={card.status} />
        <span className="chat-message-list__tool-card__name">{toolDisplayName(card.name)}</span>
        {card.status === 'canceled' && (
          <span className="chat-message-list__tool-card__mark">取消</span>
        )}
        {showBody ? (
          <ChevronDown
            size={11}
            strokeWidth={2}
            className="chat-message-list__tool-card__chevron"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            size={11}
            strokeWidth={2}
            className="chat-message-list__tool-card__chevron"
            aria-hidden="true"
          />
        )}
      </button>
      {showBody && (
        <ul className="chat-message-list__tool-card__stages">
          {stages.map((stage, i) => (
            <li key={i} className="chat-message-list__tool-card__stage">
              {stageDisplayName(stage.step, stage.completed, stage.total)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
