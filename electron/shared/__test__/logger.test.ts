import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger, RotatingFileSink, type LogSink } from '../logger.js'

/** Capturing sink: records every line handed to it. */
function makeCapturingSink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = []
  return { sink: { write: (line) => lines.push(line) }, lines }
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

describe('RotatingFileSink', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindlane-logger-'))
    logPath = path.join(dir, 'logs', 'mindlane.log')
  })

  afterEach(() => {
    logger.setSink(null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const read = (p: string): string => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '')

  it('a configured API key is replaced literally', () => {
    const sink = new RotatingFileSink(logPath)
    sink.setSecrets(['sk-live-abcdef123456'])
    logger.setSink(sink)

    logger.info('calling with key sk-live-abcdef123456 ok')

    const content = read(logPath)
    expect(content).not.toContain('sk-live-abcdef123456')
    expect(content).toContain('[REDACTED]')
  })

  it('the generic Bearer credential pattern is replaced by regex', () => {
    const sink = new RotatingFileSink(logPath)
    logger.setSink(sink)

    logger.info('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload')

    const content = read(logPath)
    expect(content).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(content).toContain('[REDACTED]')
  })

  it('secrets shorter than 8 characters are not replaced', () => {
    const sink = new RotatingFileSink(logPath)
    sink.setSecrets(['abc'])
    logger.setSink(sink)

    logger.info('abc stays')

    expect(read(logPath)).toContain('abc stays')
  })

  it('exceeding the size triggers rotation and keeps only 3 generations', () => {
    const sink = new RotatingFileSink(logPath)
    const padding = 'y'.repeat(100_000 - 1) // 100 KB per write

    // ~52 writes cross the 5 MB generation cap; 200 writes force several rotations.
    for (let i = 0; i < 200; i += 1) {
      sink.write(`g${String(i).padStart(3, '0')}${padding}`)
    }

    expect(fs.existsSync(logPath)).toBe(true)
    expect(fs.existsSync(`${logPath}.1`)).toBe(true)
    expect(fs.existsSync(`${logPath}.2`)).toBe(true)
    expect(fs.existsSync(`${logPath}.3`)).toBe(false)
    // The oldest generations were dropped: .2 must not contain the very first writes.
    expect(read(`${logPath}.2`)).not.toContain('g000')
    // Current file holds the freshest writes.
    expect(read(logPath)).toContain('g199')
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
