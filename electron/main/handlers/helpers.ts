/** AI 服务未就绪时的统一失败响应（ai 与 chat 模块共用）。 */
export function aiNotReadyResponse(): { ok: false; error: string } {
  return { ok: false, error: 'AI service not initialized' }
}
