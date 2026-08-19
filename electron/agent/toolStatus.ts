/**
 * Tool result status inference (main process side).
 *
 * Tool outputs are JSON envelopes like `{ok: false, error: ...}` for write
 * tools or free text for read tools. This is the single source used by the
 * stream layer, the end-of-turn history rebuild, and the checkpointer so the
 * persisted `ChatToolCall.status` matches what the live card showed.
 */
export function deriveToolStatus(output: string): 'success' | 'error' {
  try {
    const parsed = JSON.parse(output) as { ok?: unknown }
    if (parsed.ok === false) return 'error'
  } catch {
    /* non-JSON output — completed normally */
  }
  return 'success'
}
