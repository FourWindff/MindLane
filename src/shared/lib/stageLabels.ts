/**
 * Display labels for subgraph stages (`StreamStep`). The main process emits the
 * step vocabulary; the wording lives here, in one table both consumers read:
 * the chat tool card (subgraph stage trace) and the palace node's manual-run
 * progress. Counts ride along as `n/m` when the step carries them.
 */
const STAGE_LABELS: Record<string, string> = {
  'reading-doc': 'Reading doc',
  extracting: 'Extracting',
  merging: 'Merging',
  finalizing: 'Finalizing',
  'planning-stations': 'Planning stations',
  'generating-image': 'Generating image',
  'locating-stations': 'Locating stations',
}

export function stageDisplayName(step: string, completed?: number, total?: number): string {
  const label = STAGE_LABELS[step] ?? step
  return typeof completed === 'number' && typeof total === 'number'
    ? `${label} ${completed}/${total}`
    : label
}
