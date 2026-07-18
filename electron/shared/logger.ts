/**
 * Logging module with two channels: console + on-disk file sink.
 *
 * - Console shows info and above only (ANSI colors, dev-friendly).
 * - Once a file sink is configured, every level (including debug) is appended
 *   synchronously to disk: plain text (no ANSI), size-based rotation
 *   (3 generations kept by default), secrets redacted before writing.
 * - Log context is `module:streamIdShort`: the module name is declared via
 *   chained withContext, and the streamId short prefix is auto-attached at
 *   write time from AsyncLocalStorage (see runContext.ts).
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { format } from 'node:util'
import { currentStreamId, shortStreamId } from './runContext.js'

const ANSI_COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}

/** Stable per-module colors for the console context prefix; unknown modules hash into the fallback palette. */
const CONTEXT_COLORS: Record<string, string> = {
  mindmap: '\x1b[32m', // green
  palace: '\x1b[35m', // magenta
  MindLaneAgent: '\x1b[34m', // blue
  llm: '\x1b[36m', // cyan
  runner: '\x1b[93m', // bright yellow
  app: '\x1b[97m', // bright white
}
const FALLBACK_CONTEXT_COLORS = ['\x1b[92m', '\x1b[94m', '\x1b[95m', '\x1b[96m', '\x1b[91m']

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogSink {
  write(line: string): void
}

/** Injectable fs operations so tests can substitute in-memory IO. */
export interface FileSinkIO {
  append(path: string, data: string): void
  exists(path: string): boolean
  size(path: string): number
  rename(from: string, to: string): void
  remove(path: string): void
  ensureDir(path: string): void
}

const nodeFileSinkIO: FileSinkIO = {
  append: (path, data) => appendFileSync(path, data),
  exists: (path) => existsSync(path),
  size: (path) => (existsSync(path) ? statSync(path).size : 0),
  rename: (from, to) => renameSync(from, to),
  remove: (path) => {
    if (existsSync(path)) unlinkSync(path)
  },
  ensureDir: (path) => mkdirSync(path, { recursive: true }),
}

export interface FileSinkOptions {
  filePath: string
  /** Bytes per generation before rotating; default 5 MB. */
  maxBytes?: number
  /** Total generations kept including the current file; default 3. */
  maxGenerations?: number
  io?: FileSinkIO
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_GENERATIONS = 3
const REDACTED = '[REDACTED]'
/** Short secrets would nuke common substrings; real API keys are always longer. */
const MIN_SECRET_LENGTH = 8
const GENERIC_SECRET_PATTERNS = [
  /Bearer\s+\S+/gi,
  /Basic\s+[A-Za-z0-9+/=]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
]

/**
 * Single-file sink with size rotation and secret redaction.
 * All writes are synchronous so a crash never loses the last error line.
 * Failures inside the sink are swallowed — logging must never break the app.
 */
export class RotatingFileSink implements LogSink {
  private readonly filePath: string
  private readonly maxBytes: number
  private readonly maxGenerations: number
  private readonly io: FileSinkIO
  private secrets: string[] = []
  private dirReady = false

  constructor(options: FileSinkOptions) {
    this.filePath = options.filePath
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxGenerations = Math.max(1, options.maxGenerations ?? DEFAULT_MAX_GENERATIONS)
    this.io = options.io ?? nodeFileSinkIO
  }

  /** Configured API keys, replaced literally before writing. */
  setSecrets(secrets: string[]): void {
    this.secrets = secrets.filter((s) => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH)
  }

  write(line: string): void {
    try {
      const sanitized = this.sanitize(line)
      if (!this.dirReady) {
        this.io.ensureDir(dirname(this.filePath))
        this.dirReady = true
      }
      if (this.io.size(this.filePath) + Buffer.byteLength(sanitized) > this.maxBytes) {
        this.rotate()
      }
      this.io.append(this.filePath, sanitized)
    } catch {
      // Logging must never take the app down.
    }
  }

  private sanitize(line: string): string {
    let result = line
    for (const secret of this.secrets) {
      result = result.split(secret).join(REDACTED)
    }
    for (const pattern of GENERIC_SECRET_PATTERNS) {
      result = result.replace(pattern, REDACTED)
    }
    return result
  }

  private rotate(): void {
    // generations: current, .1, .2, ... up to maxGenerations - 1 backups
    for (let i = this.maxGenerations - 1; i >= 1; i -= 1) {
      const from = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`
      const to = `${this.filePath}.${i}`
      if (!this.io.exists(from)) continue
      this.io.remove(to)
      this.io.rename(from, to)
    }
  }
}

interface LoggerOptions {
  context?: string
  /** Shared holder so setSink on the root reaches all withContext children. */
  sinkHolder?: { current: LogSink | null }
}

class Logger {
  private context: string
  private sinkHolder: { current: LogSink | null }

  constructor(options: LoggerOptions = {}) {
    this.context = options.context ?? ''
    this.sinkHolder = options.sinkHolder ?? { current: null }
  }

  /**
   * Create a new Logger with an additional context prefix segment.
   */
  withContext(context: string): Logger {
    return new Logger({
      context: this.context ? `${this.context}:${context}` : context,
      sinkHolder: this.sinkHolder,
    })
  }

  /**
   * Attach a file sink (called once at app startup). Shared by all
   * withContext children via the holder.
   */
  setSink(sink: LogSink | null): void {
    this.sinkHolder.current = sink
  }

  private colorize(level: LogLevel, text: string): string {
    const color = this.getLevelColor(level)
    return `${color}${text}${ANSI_COLORS.reset}`
  }

  /** Console-only: color the `[context]` prefix per module so subgraph vs agent lines read apart at a glance. */
  private colorizeContext(context: string): string {
    const module = context.split(':')[0] ?? context
    let color = CONTEXT_COLORS[module]
    if (!color) {
      let hash = 0
      for (let i = 0; i < module.length; i += 1) hash = (hash * 31 + module.charCodeAt(i)) | 0
      color = FALLBACK_CONTEXT_COLORS[Math.abs(hash) % FALLBACK_CONTEXT_COLORS.length]
    }
    return `${color}[${context}]${ANSI_COLORS.reset}`
  }

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case 'info':
        return ANSI_COLORS.cyan
      case 'warn':
        return ANSI_COLORS.yellow
      case 'error':
        return ANSI_COLORS.red
      case 'debug':
        return ANSI_COLORS.gray
      default:
        return ANSI_COLORS.reset
    }
  }

  /** `模块名:streamId短前缀` — streamId auto-attached from the active run context. */
  private effectiveContext(): string {
    const streamId = currentStreamId()
    const short = streamId ? shortStreamId(streamId) : ''
    if (short) return this.context ? `${this.context}:${short}` : short
    return this.context
  }

  private log(level: LogLevel, ...args: unknown[]): void {
    const message = format(...args)
    const levelLabel = level.toUpperCase()
    const context = this.effectiveContext()
    const contextStr = context ? ` [${context}]` : ''

    // Console: info and above only, with colors and short timestamp.
    if (level !== 'debug') {
      const timestamp = new Date().toISOString().slice(11, 19)
      const coloredContext = context ? ` ${this.colorizeContext(context)}` : ''
      const output = `${timestamp} ${this.colorize(level, `[${levelLabel}]`)}${coloredContext} ${message}`
      if (level === 'error') {
        console.error(output)
      } else {
        console.log(output)
      }
    }

    // File sink: every level, plain text, full ISO timestamp.
    this.sinkHolder.current?.write(
      `${new Date().toISOString()} [${levelLabel}]${contextStr} ${message}\n`,
    )
  }

  info(...args: unknown[]): void {
    this.log('info', ...args)
  }

  warn(...args: unknown[]): void {
    this.log('warn', ...args)
  }

  error(...args: unknown[]): void {
    this.log('error', ...args)
  }

  debug(...args: unknown[]): void {
    this.log('debug', ...args)
  }
}

/**
 * Default logger instance.
 */
export const logger = new Logger()
