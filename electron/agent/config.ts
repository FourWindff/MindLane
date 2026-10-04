/**
 * Central agent-layer configuration
 *
 * Collects the "magic numbers" that used to be scattered across the
 * orchestrator / memory / palace modules so they can be tuned in one place and
 * not declared twice. Provider-specific temperature / timeout values are
 * constructor arguments (injected from user settings) and stay out of here.
 */

/**
 * Thresholds for agent scheduling and context compaction
 *
 * - recursionLimit: max super-steps a single LangGraph `StateGraph` invoke/stream may take
 *   (prevents a supervisor ↔ tools infinite loop), in steps.
 *   Shared budget: the subgraphs are mounted as main-graph nodes, so
 *   their internal super-steps count against this one limit (measured: only a nested
 *   `.invoke()` gets its own budget), which therefore has to cover compaction + supervisor
 *   rounds + mindmap waves and merges + palace stages + tools.
 *   Measured steps (scripted provider, long text cut into n leaf batches): 1 batch → 7,
 *   9 → 17, 40 → 33, i.e. ~+0.65 per batch (4 batches per leaf wave, then merge rounds).
 *   300 covers ~500 batches (~13M chars at a 32k window, far beyond a real document) and
 *   still acts as a hard stop for a runaway loop.
 * - maxCompletionTokens: tokens reserved for the model response (a fixed deduction from the input
 *   budget, independent of window size).
 * - consolidationTriggerTokens: compaction trigger threshold (**policy value**): once the
 *   conversation grows to this point, roll the summary over. The actual trigger point is the
 *   smaller of this and the input budget — small-window models trigger at their own capacity,
 *   large-window models keep a fixed summarization and memory-extraction cadence (not scaled
 *   with the window).
 * - contextCompactRecentMessages: number of recent messages kept during compaction (the tail
 *   window of the rolling summary, also used as the non-LLM trimming retry window when a call
 *   exceeds the limit).
 * - consolidationRatio: share of the input budget targeted for archiving.
 * - consolidationSafetyBuffer: safety buffer in tokens reserved when archiving.
 * - maxContextMessages: max messages entering the LLM after archiving.
 * - maxMessagesBeforeTokenCheck: message-count threshold that triggers exact token estimation.
 * - maxConsolidationRounds: max archive rounds per call.
 * - toolResultOffloadChars: tool results above this character count are offloaded to disk, in chars.
 * - toolResultMaxChars: max allowed characters for a tool result; longer results are hard-truncated, in chars.
 * - toolResultSummaryChars: length of the summary returned to the model after offloading, in chars.
 * - toolResultOffloadDirName: offload directory name, located under userData.
 */
export const AGENT_LIMITS = {
  recursionLimit: 300,
  maxCompletionTokens: 8_000,
  consolidationTriggerTokens: 64_000,
  contextCompactRecentMessages: 10,
  consolidationRatio: 0.5,
  consolidationSafetyBuffer: 1_024,
  maxContextMessages: 120,
  maxMessagesBeforeTokenCheck: 120,
  maxConsolidationRounds: 5,
  toolResultOffloadChars: 16_000,
  toolResultMaxChars: 16_000,
  toolResultSummaryChars: 1_000,
  toolResultOffloadDirName: 'tool-results',
} as const

/**
 * Memory palace coordinate-layout parameters
 *
 * - coordPad: minimum padding kept from the frame edges in the normalized
 *   coordinate system (0~1), in normalized coordinate units.
 * - minDistance: minimum allowed Euclidean distance between two anchors, in
 *   normalized coordinate units; pairs closer than this are pushed apart by
 *   `enforceMinDistance`.
 */
export const PALACE_LAYOUT = {
  coordPad: 0.05,
  minDistance: 0.12,
} as const
