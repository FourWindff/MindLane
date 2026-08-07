import {
  selectCurrentChatActiveTools,
  selectCurrentChatStreamText,
  useAiStore,
} from '@/features/chat/model/aiStore'

export function useChatStream() {
  return {
    streamingText: useAiStore(selectCurrentChatStreamText),
    activeTools: useAiStore(selectCurrentChatActiveTools),
  }
}
