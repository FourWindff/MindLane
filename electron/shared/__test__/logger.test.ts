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

describe('logger level routing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logger.setSink(null)
    vi.restoreAllMocks()
  })

  it('debug goes only to the file sink, not to console', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.debug('debug message')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[DEBUG]')
    expect(lines[0]).toContain('debug message')
    expect(console.log).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('info goes to both console and the file sink', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.info('info message')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[INFO]')
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('info message')
  })

  it('error goes through console.error and to the file sink', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.error('boom')

    expect(lines).toHaveLength(1)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('file lines contain no ANSI color codes', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.warn('colored?')

    // eslint-disable-next-line no-control-regex
    expect(lines[0]).not.toMatch(/\x1b\[/)
  })
})

describe('logger redaction', () => {
  afterEach(() => {
    logger.setSink(null)
  })

  it('a configured API key is replaced literally', () => {
    const { io, files } = makeMemoryIO()
    const sink = new RotatingFileSink({ filePath: '/logs/mindlane.log', io })
    sink.setSecrets(['sk-live-abcdef123456'])
    logger.setSink(sink)

    logger.info('calling with key sk-live-abcdef123456 ok')

    const content = files.get('/logs/mindlane.log') ?? ''
    expect(content).not.toContain('sk-live-abcdef123456')
    expect(content).toContain('[REDACTED]')
  })

  it('the generic Bearer credential pattern is replaced by regex', () => {
    const { io, files } = makeMemoryIO()
    const sink = new RotatingFileSink({ filePath: '/logs/mindlane.log', io })
    logger.setSink(sink)

    logger.info('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload')

    const content = files.get('/logs/mindlane.log') ?? ''
    expect(content).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(content).toContain('[REDACTED]')
  })

  it('secrets shorter than 8 characters are not replaced', () => {
    const { io, files } = makeMemoryIO()
    const sink = new RotatingFileSink({ filePath: '/logs/mindlane.log', io })
    sink.setSecrets(['abc'])
    logger.setSink(sink)

    logger.info('abc stays')

    expect(files.get('/logs/mindlane.log')).toContain('abc stays')
  })
})

describe('RotatingFileSink rotation', () => {
  it('exceeding the size triggers rotation and keeps only 3 generations', () => {
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

describe('logger withContext prefix', () => {
  afterEach(() => {
    logger.setSink(null)
  })

  it('context is chained with colons and wrapped in brackets', () => {
    const { sink, lines } = makeCapturingSink()
    logger.setSink(sink)

    logger.withContext('mindmap').withContext('ab12cd34').info('hello')

    expect(lines[0]).toContain('[mindmap:ab12cd34]')
  })
})
