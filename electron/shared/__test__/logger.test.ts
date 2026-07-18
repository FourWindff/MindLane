import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger, RotatingFileSink, type LogSink, type FileSinkIO } from '../logger.js'

/** Capturing sink: records every line handed to it. */
function makeCapturingSink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = []
  return { sink: { write: (line) => lines.push(line) }, lines }
}

/** In-memory virtual fs for RotatingFileSink rotation tests. */
function makeMemoryIO(): { io: FileSinkIO; files: Map<string, string> } {
  const files = new Map<string, string>()
  const io: FileSinkIO = {
    append: (path, data) => files.set(path, (files.get(path) ?? '') + data),
    exists: (path) => files.has(path),
    size: (path) => files.get(path)?.length ?? 0,
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    },
    remove: (path) => files.delete(path),
    ensureDir: () => {},
  }
  return { io, files }
}

describe('logger 级别路由', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logger.setSink(null)
    vi.restoreAllMocks()
  })

  it('debug 只进文件 sink，不进 console', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.debug('debug message')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[DEBUG]')
    expect(lines[0]).toContain('debug message')
    expect(console.log).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('info 同时进 console 和文件 sink', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.info('info message')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[INFO]')
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('info message')
  })

  it('error 走 console.error 并进文件 sink', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.error('boom')

    expect(lines).toHaveLength(1)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('文件行不含 ANSI 颜色码', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.warn('colored?')

    // eslint-disable-next-line no-control-regex
    expect(lines[0]).not.toMatch(/\x1b\[/)
  })
})

describe('logger 脱敏', () => {
  afterEach(() => {
    logger.setSink(null)
  })

  it('已配置的 API key 被字面量替换', () => {
    const { io, files } = makeMemoryIO()
    const sink = new RotatingFileSink({ filePath: '/logs/mindlane.log', io })
    sink.setSecrets(['sk-live-abcdef123456'])
    logger.setSink(sink)

    logger.info('calling with key sk-live-abcdef123456 ok')

    const content = files.get('/logs/mindlane.log') ?? ''
    expect(content).not.toContain('sk-live-abcdef123456')
    expect(content).toContain('[REDACTED]')
  })

  it('Bearer 通用凭据模式被正则替换', () => {
    const { io, files } = makeMemoryIO()
    const sink = new RotatingFileSink({ filePath: '/logs/mindlane.log', io })
    logger.setSink(sink)

    logger.info('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload')

    const content = files.get('/logs/mindlane.log') ?? ''
    expect(content).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(content).toContain('[REDACTED]')
  })

  it('短于 8 字符的 secret 不参与替换', () => {
    const { io, files } = makeMemoryIO()
    const sink = new RotatingFileSink({ filePath: '/logs/mindlane.log', io })
    sink.setSecrets(['abc'])
    logger.setSink(sink)

    logger.info('abc stays')

    expect(files.get('/logs/mindlane.log')).toContain('abc stays')
  })
})

describe('RotatingFileSink 轮转', () => {
  it('超大小触发轮转，只保留 3 代', () => {
    const { io, files } = makeMemoryIO()
    const sink = new RotatingFileSink({
      filePath: '/logs/mindlane.log',
      maxBytes: 20,
      maxGenerations: 3,
      io,
    })

    // Each write is 5 bytes; rotation triggers every 4 writes.
    for (let i = 0; i < 20; i += 1) {
      sink.write(`g${String(i).padStart(3, '0')}\n`)
    }

    const names = [...files.keys()].sort()
    expect(names).toEqual(['/logs/mindlane.log', '/logs/mindlane.log.1', '/logs/mindlane.log.2'])
    // The oldest generations were dropped: .2 must not contain the very first writes.
    expect(files.get('/logs/mindlane.log.2')).not.toContain('g000')
    // Current file holds the freshest writes.
    expect(files.get('/logs/mindlane.log')).toContain('g019')
  })
})

describe('logger withContext 前缀', () => {
  afterEach(() => {
    logger.setSink(null)
  })

  it('上下文以冒号链式拼接并包在方括号内', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.withContext('mindmap').withContext('ab12cd34').info('hello')

    expect(lines[0]).toContain('[mindmap:ab12cd34]')
  })
})
