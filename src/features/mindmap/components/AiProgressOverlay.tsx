import { AlertCircle } from 'lucide-react'
import { useAiStore, type AiPipelineStep } from '@/features/chat/model/aiStore'

function stepDisplayName(step: AiPipelineStep): string {
  switch (step) {
    case 'preparing': return '准备文件…'
    case 'analyzing': return '分析节点内容…'
    case 'planning': return '规划记忆路线…'
    case 'generating-image': return '生成宫殿图片…'
    case 'building': return '构建宫殿节点…'
    case 'reading-doc': return '读取文档…'
    case 'extracting': return 'AI 提取结构…'
    case 'merging': return '合并子树…'
    case 'finalizing': return '生成 YAML…'
    case 'generating-map': return '生成思维导图…'
    case 'chatting': return 'AI 对话中…'
    default: return '处理中…'
  }
}

export function AiProgressOverlay() {
  const busy = useAiStore((s) => s.busy)
  const step = useAiStore((s) => s.step)
  const errorMessage = useAiStore((s) => s.errorMessage)
  const clearError = useAiStore((s) => s.clearError)

  if (errorMessage) {
    return (
      <div className="ai-progress-overlay">
        <div className="ai-progress-overlay__card ai-progress-overlay__card--error" onClick={clearError}>
          <AlertCircle size={16} strokeWidth={1.6} />
          <span className="ai-progress-overlay__text">{errorMessage}</span>
          <span className="ai-progress-overlay__dismiss">点击关闭</span>
        </div>
      </div>
    )
  }

  if (!busy || step === 'idle' || step === 'chatting') return null

  return (
    <div className="ai-progress-overlay">
      <div className="ai-progress-overlay__card">
        <div className="ai-progress-overlay__spinner" />
        <span className="ai-progress-overlay__text">{stepDisplayName(step)}</span>
      </div>
    </div>
  )
}
