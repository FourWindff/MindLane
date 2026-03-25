/**
 * 单条快捷键定义。`group` 为任意字符串，帮助面板会按 group 分块展示（未知分组显示原文）。
 */
export type ShortcutRegistration = {
  id: string
  /** 规范串，如 `mod+slash`，与 `eventComboFromCode` 输出一致 */
  combo: string
  description: string
  group: string
  /** 在输入框、textarea、select、contenteditable 内是否忽略 */
  preventWhenTyping: boolean
  /** 返回 `false` 表示不拦截（不调用 preventDefault） */
  handler: (e: KeyboardEvent) => boolean | void
  /** 为 false 时不触发 */
  enabled?: () => boolean
  /** 越大越先匹配，默认 0 */
  priority?: number
  /** 为 false 时不列入帮助面板（默认 true） */
  showInHelp?: boolean
}
