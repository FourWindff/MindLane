import { describe, expect, it } from 'vitest'
import { formatXmlError, MindmapXmlError } from '../index.js'

describe('formatXmlError', () => {
  it('formats MindmapXmlError as [code] message + recovery strategy', () => {
    const err = new MindmapXmlError('block_not_found', '定位节点「n1」不存在')
    expect(formatXmlError(err)).toBe(
      '[block_not_found] 定位节点「n1」不存在。恢复策略：先调用 readMindmap 重新定位后再操作',
    )
  })

  it('falls back to a plain error message for non-XML errors', () => {
    expect(formatXmlError(new Error('boom'))).toBe('boom')
    expect(formatXmlError('string error')).toBe('string error')
  })
})
