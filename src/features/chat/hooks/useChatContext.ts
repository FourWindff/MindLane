import { useRef, useCallback } from 'react'
import { useActiveMindmapInstance } from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'

function useShallowById<T, U extends { id: string }>(
  selector: (state: T) => U[],
): (state: T) => U[] {
  const prev = useRef<U[]>()
  return (state) => {
    const next = selector(state)
    if (
      prev.current &&
      prev.current.length === next.length &&
      prev.current.every((n, i) => n.id === next[i]!.id)
    ) {
      return prev.current
    }
    prev.current = next
    return next
  }
}

export interface QuickAction {
  label: string
  prompt: string
}

export function useChatContext() {
  const activeInstance = useActiveMindmapInstance()
  const selectedNodes = activeInstance.store(
    useShallowById((s) => s.nodes.filter((n) => n.selected)),
  )

  const editor = useActiveMindmapEditor()

  const clearNodeSelection = useCallback(() => {
    editor.clearNodeSelection()
  }, [editor])

  const features = ['生成思维导图', '生成记忆宫殿']

  const emptyHint = `AI 助手可以${features.join('、')}`

  const quickActions: QuickAction[] = [
    { label: '生成思维导图', prompt: '请帮我生成一个思维导图' },
    { label: '总结内容', prompt: '请总结当前思维导图的内容' },
    { label: '头脑风暴', prompt: '请帮我进行头脑风暴，生成一些创意想法' },
    { label: '优化结构', prompt: '请帮我优化当前思维导图的结构' },
  ]

  return {
    selectedNodes,
    clearNodeSelection,
    emptyHint,
    quickActions,
  }
}
