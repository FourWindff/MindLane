import type { StructuredToolInterface } from '@langchain/core/tools'
import type { McpCredentialStore } from './credentials.js'
import type { LoopbackOAuthProvider } from './oauth.js'

/** MCP server connection state (MCP user state, persisted to settings.json) */
type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed'

/** Per-server user state entry in settings.json: only the connection state and non-sensitive display info */
export interface McpServerUserState {
  state: McpConnectionState
  workspaceName?: string
}

/** Runtime status of a single server (includes the error message shown in the UI) */
export interface McpServerStatus {
  state: McpConnectionState
  workspaceName?: string
  error?: string
}

/** Field metadata of the non-OAuth server connection form; the renderer draws the form from it and the main process validates against the definition */
export interface McpCredentialField {
  /** Form field id (also the key in the credential store's secrets) */
  id: string
  /** Display label in the form */
  label: string
  /** Required field; when missing, the connection fails outright without sending a request */
  required?: boolean
  /** Sensitive field: rendered as a password input; plaintext only reaches disk encrypted by the credential store */
  secret?: boolean
}

/** Full status merged with catalog metadata, returned to the renderer by mcp:status */
export interface McpServerStatusInfo extends McpServerStatus {
  id: string
  displayName: string
  description: string
  /** Connection form field metadata for non-OAuth servers (omitted for OAuth servers) */
  credentialFields?: McpCredentialField[]
  /** Failure hint copy (e.g. "open Obsidian and enable the Local REST API plugin") */
  failureHint?: string
}

/** Context passed to a server's authorization factory */
interface McpAuthContext {
  credentialStore: McpCredentialStore
  /** Loopback callback URL (for interactive authorization the temporary HTTP server picks the port) */
  redirectUrl: string
  /** Whether opening a browser is allowed (false for the silent reconnect at startup) */
  interactive: boolean
  openBrowser: (url: string) => void
}

/** MCP catalog entry: adding a server = adding one definition under servers/ */
export interface McpServerDefinition {
  id: string
  displayName: string
  /** One-line description shown in the settings panel */
  description: string
  transport: 'stdio' | 'http' | 'sse'
  connection: {
    url?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
  }
  /**
   * OAuth-mode authorization factory; mutually exclusive with createAuthHeaders, choose one per definition.
   * The settings panel uses the browser authorization flow for such servers.
   */
  createAuthProvider?: (ctx: McpAuthContext) => LoopbackOAuthProvider
  /**
   * Non-OAuth mode: resolves the key/value pairs to inject as HTTP headers from the credential store (e.g. Authorization: Bearer);
   * mutually exclusive with createAuthProvider. The settings panel uses the credential form flow for such servers.
   */
  createAuthHeaders?: (store: McpCredentialStore) => Promise<Record<string, string>>
  /** Connection form field metadata (declared by non-OAuth servers; the renderer draws the form from the metadata) */
  credentialFields?: McpCredentialField[]
  /** Failure hint copy; appended to the error message when a connection fails */
  failureHint?: string
  /** Tool names removed before registering into ToolRegistry (e.g. Obsidian's destructive tools) */
  excludeTools?: string[]
  /** After a successful connection, pulls display info (e.g. the workspace name) from the server's tool set; should return undefined on failure */
  fetchWorkspaceName?: (tools: StructuredToolInterface[]) => Promise<string | undefined>
}

/** Minimal client interface McpManager depends on (return type of the single test seam) */
export interface McpClientLike {
  getTools(): Promise<StructuredToolInterface[]>
  close(): Promise<void>
}
