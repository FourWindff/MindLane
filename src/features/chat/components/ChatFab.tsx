import { motion } from 'motion/react'
import { Bot } from 'lucide-react'
import { useAiStore } from '@/features/chat/model/aiStore'

interface ChatFabProps {
  onExpand: () => void
}

export function ChatFab({ onExpand }: ChatFabProps) {
  const busy = useAiStore((s) => s.busy)
  const progress = useAiStore((s) => s.progress)

  return (
    <motion.button
      type="button"
      className="chat-float-fab"
      onClick={onExpand}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
    >
      <Bot size={36} strokeWidth={1.5} className="chat-float-fab__icon" />
      <span className={`chat-float-fab__status chat-float-fab__status--${busy ? 'busy' : 'idle'}`} />
      {busy && (
        <svg className="chat-float-fab__progress" viewBox="0 0 88 88">
          <circle
            className="chat-float-fab__progress-circle"
            cx="44"
            cy="44"
            r="42"
            strokeDasharray={2 * Math.PI * 42}
            strokeDashoffset={2 * Math.PI * 42 * (1 - progress / 100)}
          />
        </svg>
      )}
      <span className="chat-float-fab__tooltip">Neural Assistant</span>
    </motion.button>
  )
}
