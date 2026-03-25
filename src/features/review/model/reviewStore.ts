import { create } from 'zustand'

export interface ReviewCard {
  id: string
  nodeId: string
  content: string
  anchorVisual?: string
  nextReviewAt: number
  interval: number
  ease: number
  repetitions: number
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

interface ReviewState {
  cards: ReviewCard[]
  currentIndex: number
  showAnswer: boolean
  sessionActive: boolean

  startSession: (cards: ReviewCard[]) => void
  endSession: () => void
  revealAnswer: () => void
  rateCard: (rating: ReviewRating) => void
  getDueCards: () => ReviewCard[]
  currentCard: () => ReviewCard | null
}

function computeNextReview(card: ReviewCard, rating: ReviewRating): Partial<ReviewCard> {
  const now = Date.now()
  let { interval, ease, repetitions } = card

  switch (rating) {
    case 'again':
      interval = 1
      ease = Math.max(1.3, ease - 0.2)
      repetitions = 0
      break
    case 'hard':
      interval = Math.max(1, Math.ceil(interval * 1.2))
      ease = Math.max(1.3, ease - 0.15)
      repetitions += 1
      break
    case 'good':
      if (repetitions === 0) interval = 1
      else if (repetitions === 1) interval = 6
      else interval = Math.ceil(interval * ease)
      repetitions += 1
      break
    case 'easy':
      if (repetitions === 0) interval = 4
      else interval = Math.ceil(interval * ease * 1.3)
      ease += 0.15
      repetitions += 1
      break
  }

  const minutesMs = interval * 60 * 1000
  return {
    interval,
    ease,
    repetitions,
    nextReviewAt: now + minutesMs,
  }
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  cards: [],
  currentIndex: 0,
  showAnswer: false,
  sessionActive: false,

  startSession: (cards) => {
    set({
      cards,
      currentIndex: 0,
      showAnswer: false,
      sessionActive: true,
    })
  },

  endSession: () => {
    set({ sessionActive: false, currentIndex: 0, showAnswer: false })
  },

  revealAnswer: () => set({ showAnswer: true }),

  rateCard: (rating) => {
    const { cards, currentIndex } = get()
    const card = cards[currentIndex]
    if (!card) return

    const updates = computeNextReview(card, rating)
    const updatedCards = cards.map((c, i) =>
      i === currentIndex ? { ...c, ...updates } : c,
    )

    const nextIndex = currentIndex + 1
    if (nextIndex >= updatedCards.length) {
      set({ cards: updatedCards, sessionActive: false, showAnswer: false })
    } else {
      set({ cards: updatedCards, currentIndex: nextIndex, showAnswer: false })
    }
  },

  getDueCards: () => {
    const now = Date.now()
    return get().cards.filter((c) => c.nextReviewAt <= now)
  },

  currentCard: () => {
    const { cards, currentIndex, sessionActive } = get()
    if (!sessionActive) return null
    return cards[currentIndex] ?? null
  },
}))
