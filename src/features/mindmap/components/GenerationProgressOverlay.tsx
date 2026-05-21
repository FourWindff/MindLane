export function GenerationProgressOverlay({ progress }: { progress: string | null }) {
  if (!progress) return null

  return (
    <div className="ai-progress-overlay">
      <div className="ai-progress-overlay__card">
        <div className="ai-progress-overlay__spinner" />
        <span className="ai-progress-overlay__text">{progress}</span>
      </div>
    </div>
  )
}
