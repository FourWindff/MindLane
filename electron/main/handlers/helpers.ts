/** The shared failure response when the AI service is not ready (used by the ai and chat modules). */
export function aiNotReadyResponse(): { ok: false; error: string } {
  return { ok: false, error: 'AI service not initialized' }
}
