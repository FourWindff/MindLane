import { urlToDataUrl } from '../../providers/index.js'
import type { PalaceSubgraphStateType } from '../../state.js'

/**
 * 将 Palace 子图中的远程图片 URL 统一转换为 data URL。
 *
 * - 已经是 data: 开头的 URL 直接保留
 * - 转换失败时保留原 URL 作为降级
 * - state 有错误时返回原始 imageUrls 作为空更新
 * - imageUrls 为空时返回空数组
 */
export async function normalizePalaceImageUrls(
  state: Pick<PalaceSubgraphStateType, 'error' | 'imageUrls'>,
): Promise<Pick<PalaceSubgraphStateType, 'imageUrls'>> {
  if (state.error || state.imageUrls.length === 0) {
    return { imageUrls: state.imageUrls }
  }

  const normalized = await Promise.all(
    state.imageUrls.map(async (url) => {
      if (url.startsWith('data:')) return url
      try {
        return await urlToDataUrl(url)
      } catch {
        return url
      }
    }),
  )

  return { imageUrls: normalized }
}
