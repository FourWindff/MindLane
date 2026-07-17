import type { McpServerDefinition } from '../types.js'
import { notionServer } from './notion.js'

/** 内置 MCP catalog：新增 server = 在这里加一条定义 */
export const MCP_SERVERS: McpServerDefinition[] = [notionServer]
