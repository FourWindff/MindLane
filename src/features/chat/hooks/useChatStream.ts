import { useAiStore } from '@/features/chat/model/aiStore'

export function useChatStream() {
  return {
    streamingText: useAiStore((state) => state.streamText),
    activeTools: useAiStore((state) => state.activeTools),
  }
}
