import { useState } from 'react'
import { Ban, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import type { ChatToolCall, ChatToolCallStep } from '@/shared/lib/fileFormat'
import { isSubgraphTool, toolDisplayName } from '@/features/chat/lib/chatUtils'
import { stageDisplayName } from '@/shared/lib/stageLabels'

type ToolCardStatus = NonNullable<ChatToolCall['status']>

/** Normalized card: streaming (ToolCard) and history (ChatToolCall) share one render contract. */
export interface ToolCardItem {
  name: string
  status?: ToolCardStatus
  /** Streaming subgraph stage (live, counts passed through from step events). */
  step?: string
  completed?: number
  total?: number
  /** Accumulated live subgraph stages (streaming equivalent of `steps`). */
  stages?: ChatToolCallStep[]
  /** Historical subgraph stage trace (persisted, ChatToolCall.steps). */
  steps?: ChatToolCallStep[]
}

function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

/**
 * Tool card region: an area above the AI bubble, one tool call per line,
 * left-aligned. Streaming and history messages share the same component;
 * history cards without a status (old sessions) are inferred as finished (✓).
 * Subgraph cards expand by default while running to show stage progress and
 * auto-collapse when done; manual expand/collapse is supported.
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
    card.stages ??
    (card.step ? [{ step: card.step, completed: card.completed, total: card.total }] : undefined)
  // Subgraph cards carry a stage trace and can expand; write/read cards stay
  // single-line, and so does a subgraph that failed before emitting any stage.
  if (!isSubgraphTool(card.name) || !stages || stages.length === 0) {
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
  return cx('chat-message-list__tool-card', `chat-message-list__tool-card--${status}`, extra)
}

function SingleLineCard({ card }: { card: ToolCardItem & { status: ToolCardStatus } }) {
  return (
    <span className={CardClassName(card.status)}>
      <StatusGlyph status={card.status} />
      <span className="chat-message-list__tool-card__name">{toolDisplayName(card.name)}</span>
      {card.status === 'canceled' && (
        <span className="chat-message-list__tool-card__mark">Canceled</span>
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
  // Manual expand/collapse: null follows the default (expanded while running,
  // collapsed when done).
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const showBody = expanded ?? card.status === 'running'
  return (
    <div className={CardClassName(card.status, 'chat-message-list__tool-card--subgraph')}>
      <button
        type="button"
        className="chat-message-list__tool-card__toggle"
        onClick={() => setExpanded(!showBody)}
        aria-expanded={showBody}
        aria-label={`${toolDisplayName(card.name)} ${showBody ? 'Collapse' : 'Expand'}`}
      >
        <StatusGlyph status={card.status} />
        <span className="chat-message-list__tool-card__name">{toolDisplayName(card.name)}</span>
        {card.status === 'canceled' && (
          <span className="chat-message-list__tool-card__mark">Canceled</span>
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
