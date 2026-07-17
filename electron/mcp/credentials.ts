import fs from 'node:fs'
import path from 'node:path'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { logger } from '../shared/logger.js'

/** 凭据加解密接口；生产环境由 Electron safeStorage 实现，测试中可注入简易实现 */
export interface McpCredentialCrypto {
  encrypt(plainText: string): string
  decrypt(cipherText: string): string
}

export interface McpStoredCredentials {
  /** DCR 动态注册拿到的 client 凭据（必须持久化，重复注册会使既有授权成为孤儿） */
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
}

/**
 * 单个 MCP server 的凭据存储。
 * 内容（DCR client 凭据 + OAuth tokens）经 crypto 加密后存为 userData 下的独立文件；
 * crypto 缺失（safeStorage 不可用）时退化为纯内存并警告，不落盘。
 */
export class McpCredentialStore {
  private memory: McpStoredCredentials | null = null
  private warnLogged = false

  constructor(
    private readonly filePath: string,
    private readonly crypto?: McpCredentialCrypto,
  ) {}

  load(): McpStoredCredentials {
    if (!this.crypto) return this.memory ?? {}
    if (this.memory) return this.memory
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        this.memory = JSON.parse(this.crypto.decrypt(raw)) as McpStoredCredentials
        return this.memory
      }
    } catch (err) {
      logger.warn('[mcp] failed to read credentials %s: %o', this.filePath, err)
    }
    this.memory = {}
    return this.memory
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.merge({ clientInformation: info })
  }

  saveTokens(tokens: OAuthTokens): void {
    this.merge({ tokens })
  }

  clear(): void {
    this.memory = {}
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
    } catch (err) {
      logger.warn('[mcp] failed to delete credentials %s: %o', this.filePath, err)
    }
  }

  private merge(patch: Partial<McpStoredCredentials>): void {
    const next = { ...this.load(), ...patch }
    this.memory = next
    if (!this.crypto) {
      if (!this.warnLogged) {
        this.warnLogged = true
        logger.warn(
          '[mcp] safeStorage 不可用，%s 的凭据仅保存在内存中，重启后需要重新授权',
          path.basename(this.filePath),
        )
      }
      return
    }
    try {
      // 与 fs/atomicWrite 同义的同步版本：先写临时文件再 rename，避免读者看到半截文件
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmpPath = `${this.filePath}.tmp.${process.pid}`
      fs.writeFileSync(tmpPath, this.crypto.encrypt(JSON.stringify(next)), {
        encoding: 'utf-8',
        mode: 0o600,
      })
      fs.renameSync(tmpPath, this.filePath)
    } catch (err) {
      logger.warn('[mcp] failed to persist credentials %s: %o', this.filePath, err)
    }
  }
}
