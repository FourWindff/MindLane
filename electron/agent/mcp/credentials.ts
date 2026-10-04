import fs from 'node:fs'
import path from 'node:path'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { logger } from '../../shared/logger.js'

/** Credential encryption interface; implemented by Electron safeStorage in production, a simple implementation can be injected in tests */
export interface McpCredentialCrypto {
  encrypt(plainText: string): string
  decrypt(cipherText: string): string
}

interface McpStoredCredentials {
  /** Client credentials obtained through DCR dynamic registration (must be persisted; re-registering orphans the existing authorization) */
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  /** Non-OAuth connection credentials (MCP connection credentials): keys entered in the form, stored encrypted in a separate file under userData, never in settings.json */
  secrets?: Record<string, string>
}

/**
 * Credential store for a single MCP server.
 * The contents (DCR client credentials + OAuth tokens) are encrypted by crypto and stored as a separate file under userData;
 * when crypto is missing (safeStorage unavailable) it degrades to memory-only with a warning and never touches disk.
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
      logger.withContext('mcp').warn('failed to read credentials %s: %o', this.filePath, err)
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

  saveSecrets(secrets: Record<string, string>): void {
    this.merge({ secrets: { ...this.load().secrets, ...secrets } })
  }

  clear(): void {
    this.memory = {}
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
    } catch (err) {
      logger.withContext('mcp').warn('failed to delete credentials %s: %o', this.filePath, err)
    }
  }

  private merge(patch: Partial<McpStoredCredentials>): void {
    const next = { ...this.load(), ...patch }
    this.memory = next
    if (!this.crypto) {
      if (!this.warnLogged) {
        this.warnLogged = true
        logger.warn(
          '[mcp] safeStorage unavailable, credentials for %s are kept in memory only and must be re-authorized after a restart',
          path.basename(this.filePath),
        )
      }
      return
    }
    try {
      // Synchronous counterpart of fs/atomicWrite: write a temp file then rename, so readers never see a half-written file
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmpPath = `${this.filePath}.tmp.${process.pid}`
      fs.writeFileSync(tmpPath, this.crypto.encrypt(JSON.stringify(next)), {
        encoding: 'utf-8',
        mode: 0o600,
      })
      fs.renameSync(tmpPath, this.filePath)
    } catch (err) {
      logger.withContext('mcp').warn('failed to persist credentials %s: %o', this.filePath, err)
    }
  }
}
