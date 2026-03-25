import { useCallback } from 'react'
import type { PalaceNodeData } from '@/shared/lib/fileFormat'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useReviewStore, type ReviewCard, type ReviewRating } from '@/features/review/model/reviewStore'

function collectPalaceCards(nodes: { id: string; type?: string; data: Record<string, unknown> }[]): ReviewCard[] {
  const cards: ReviewCard[] = []
  const now = Date.now()

  for (const node of nodes) {
    if (node.type !== 'palace') continue
    const data = node.data as PalaceNodeData
    if (!data.stations) continue

    for (const station of data.stations) {
      cards.push({
        id: `${node.id}-${station.order}`,
        nodeId: node.id,
        content: station.content,
        anchorVisual: station.anchorVisual,
        nextReviewAt: now,
        interval: 1,
        ease: 2.5,
        repetitions: 0,
      })
    }
  }
  return cards
}

export function ReviewPanel() {
  const nodes = useMindmapStore((s) => s.nodes)
  const sessionActive = useReviewStore((s) => s.sessionActive)
  const showAnswer = useReviewStore((s) => s.showAnswer)
  const currentCard = useReviewStore((s) => s.currentCard)()
  const startSession = useReviewStore((s) => s.startSession)
  const endSession = useReviewStore((s) => s.endSession)
  const revealAnswer = useReviewStore((s) => s.revealAnswer)
  const rateCard = useReviewStore((s) => s.rateCard)
  const cards = useReviewStore((s) => s.cards)
  const currentIndex = useReviewStore((s) => s.currentIndex)

  const beginReview = useCallback(() => {
    const allCards = collectPalaceCards(nodes)
    if (allCards.length === 0) return
    startSession(allCards)
  }, [nodes, startSession])

  const palaceCount = nodes.filter((n) => n.type === 'palace').length

  if (!sessionActive) {
    return (
      <div>
        <div className="panel-section">
          <div className="panel-section__title">间隔重复复习</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--ml-text-muted)', margin: '0 0 0.5rem', lineHeight: 1.4 }}>
            基于记忆宫殿的站点进行间隔重复复习。
            {palaceCount === 0 && ' 当前导图中还没有记忆宫殿节点。'}
          </p>
          <button
            type="button"
            className="panel-btn panel-btn--primary panel-btn--full"
            onClick={beginReview}
            disabled={palaceCount === 0}
          >
            开始复习 {palaceCount > 0 && `(${palaceCount} 个宫殿)`}
          </button>
        </div>
      </div>
    )
  }

  if (!currentCard) {
    return (
      <div>
        <div className="panel-section">
          <div className="panel-section__title">复习完成</div>
          <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            本轮复习已完成！共复习 {cards.length} 张卡片。
          </p>
          <button
            type="button"
            className="panel-btn panel-btn--full"
            onClick={endSession}
          >
            返回
          </button>
        </div>
      </div>
    )
  }

  const progress = cards.length > 0 ? `${currentIndex + 1} / ${cards.length}` : ''

  return (
    <div>
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div className="panel-section__title" style={{ marginBottom: 0 }}>
            复习中
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--ml-text-muted)' }}>{progress}</span>
        </div>

        <div
          style={{
            padding: '1rem',
            borderRadius: 10,
            border: '1px solid var(--ml-border)',
            background: '#fff',
            minHeight: 120,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: '0.5rem',
          }}
        >
          {currentCard.anchorVisual && (
            <div style={{ fontSize: '0.72rem', color: 'var(--ml-text-muted)' }}>
              锚点：{currentCard.anchorVisual}
            </div>
          )}

          {!showAnswer ? (
            <>
              <div style={{ fontSize: '1rem', fontWeight: 600, margin: '0.5rem 0' }}>
                这个锚点对应什么内容？
              </div>
              <button
                type="button"
                className="panel-btn panel-btn--primary"
                onClick={revealAnswer}
              >
                显示答案
              </button>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  padding: '0.5rem',
                  borderRadius: 8,
                  background: 'var(--ml-fill-soft)',
                  width: '100%',
                }}
              >
                {currentCard.content}
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                {(['again', 'hard', 'good', 'easy'] as ReviewRating[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="panel-btn"
                    onClick={() => rateCard(r)}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.35rem 0.65rem',
                      ...(r === 'again' ? { borderColor: '#b91c1c', color: '#b91c1c' } : {}),
                      ...(r === 'easy' ? { borderColor: '#16a34a', color: '#16a34a' } : {}),
                    }}
                  >
                    {ratingLabel(r)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          className="panel-btn panel-btn--full"
          onClick={endSession}
          style={{ marginTop: '0.5rem' }}
        >
          结束复习
        </button>
      </div>
    </div>
  )
}

function ratingLabel(r: ReviewRating): string {
  switch (r) {
    case 'again': return '忘了'
    case 'hard': return '困难'
    case 'good': return '记住'
    case 'easy': return '简单'
  }
}
