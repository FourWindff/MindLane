/**
 * 彩色日志模块
 * 使用原生 ANSI 颜色码实现，无外部依赖
 */

const ANSI_COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LoggerOptions {
  context?: string
  debugEnabled?: boolean
}

export class Logger {
  private context: string
  private debugEnabled: boolean

  constructor(options: LoggerOptions = {}) {
    this.context = options.context ?? ''
    this.debugEnabled = options.debugEnabled ?? false
  }

  /**
   * 创建一个带上下文前缀的新 Logger 实例
   */
  withContext(context: string): Logger {
    return new Logger({
      context: this.context ? `${this.context}:${context}` : context,
      debugEnabled: this.debugEnabled,
    })
  }

  /**
   * 启用或禁用 debug 级别日志
   */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled
  }

  private colorize(level: LogLevel, text: string): string {
    const color = this.getLevelColor(level)
    return `${color}${text}${ANSI_COLORS.reset}`
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

  private log(level: LogLevel, ...args: unknown[]): void {
    if (level === 'debug' && !this.debugEnabled) {
      return
    }

    const levelLabel = level.toUpperCase()
    const timestamp = new Date().toISOString().slice(11, 19)
    const coloredLevel = this.colorize(level, `[${levelLabel}]`)
    const contextStr = this.context ? ` [${this.context}]` : ''

    const output = `${timestamp} ${coloredLevel}${contextStr}`

    if (level === 'error') {
      console.error(output, ...args)
    } else {
      console.log(output, ...args)
    }
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
 * 检测是否在开发环境
 */
function isDevEnvironment(): boolean {
  try {
    // Vite 环境变量
    if (import.meta.env?.DEV) return true
    // 环境变量
    if (process.env.NODE_ENV === 'development') return true
  } catch {
    // 忽略访问环境变量时的错误
  }
  return false
}

/**
 * 默认 Logger 实例
 */
export const logger = new Logger({ debugEnabled: isDevEnvironment() })
