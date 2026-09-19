/**
 * Renderer → main-process diagnostic log (fire-and-forget bridge).
 *
 * Renderer errors have no UI outlet (PRD: no toasts, no error cards) — every
 * renderer error path reports here, so a user running into trouble can hand the
 * log file to a developer. A missing bridge is swallowed: logging must never
 * break the app.
 */
export function reportRendererError(message: string): void {
  window.mindlane?.shell?.logError?.(message)
}

/** Report a recoverable renderer degradation without promoting it to an error. */
export function reportRendererWarning(message: string): void {
  window.mindlane?.shell?.logWarning?.(message)
}
