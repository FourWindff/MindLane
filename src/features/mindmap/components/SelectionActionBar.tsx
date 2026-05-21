import { Landmark } from 'lucide-react'

export function SelectionActionBar({
  selectedTopicCount,
  onGeneratePalace,
  aiBusy,
  palaceEnabled,
}: {
  selectedTopicCount: number
  onGeneratePalace: () => void
  aiBusy: boolean
  palaceEnabled: boolean
}) {
  if (selectedTopicCount < 1 || aiBusy) return null

  return (
    <div className="selection-bar">
      <span className="selection-bar__count">已选 {selectedTopicCount} 个主题</span>
      <button
        type="button"
        className="selection-bar__btn"
        onClick={onGeneratePalace}
        disabled={!palaceEnabled}
        title={palaceEnabled ? undefined : '当前模型不支持记忆宫殿功能'}
      >
        <Landmark size={14} strokeWidth={1.6} />
        生成记忆宫殿
      </button>
    </div>
  )
}
