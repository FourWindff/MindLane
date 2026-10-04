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
      <span className="selection-bar__count">{selectedTopicCount} topics selected</span>
      <button
        type="button"
        className="btn selection-bar__btn"
        onClick={onGeneratePalace}
        disabled={!palaceEnabled}
        title={palaceEnabled ? undefined : 'Chat model configuration required'}
      >
        <Landmark size={14} strokeWidth={1.6} />
        Generate memory palace
      </button>
    </div>
  )
}
