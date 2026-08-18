import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'

/**
 * 点击胶囊时解析要打开的文件路径：优先当前已加载实例（改名/移动后最新），
 * 未在本启动打开过时回退持久映射 `fileUuidPaths`。
 */
export function resolveCapsuleOpenPath(
  fileUuid: string,
  fileUuidPaths: Record<string, string>,
): string | null {
  return (
    mindmapRegistry.getByFileUuid(fileUuid)?.store.getState().filePath ??
    fileUuidPaths[fileUuid] ??
    null
  )
}
