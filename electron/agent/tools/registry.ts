import type { StructuredToolInterface } from '@langchain/core/tools'
import { isVirtualSubgraphTool } from '../subgraphRouter.js'

/**
 * ToolRegistry - A generic registry for AI tools.
 *
 * Responsibilities:
 * 1. Maintains the full list of tools visible to the model (allTools).
 * 2. Maintains the list of real tools executable by ToolNode (executableTools),
 *    automatically filtering out virtual subgraph routing tools.
 * 3. Provides tool registration and prevents duplicate names.
 *
 * Notes:
 * - This class is agnostic of specific business tools; default tool assembly is handled elsewhere.
 * - registerTool must be called before the registry is consumed.
 * - allTools / executableTools return internal array references; callers must not mutate them.
 */
export class ToolRegistry {
  private _allTools: StructuredToolInterface[] = []
  private _executableTools: StructuredToolInterface[] = []

  /**
   * Register a tool.
   * @throws When a tool with the same name is already registered.
   */
  registerTool(tool: StructuredToolInterface): void {
    if (this._allTools.some((t) => t.name === tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`)
    }

    this._allTools.push(tool)

    if (!isVirtualSubgraphTool(tool.name)) {
      this._executableTools.push(tool)
    }
  }

  /**
   * All tools visible to the model, including virtual subgraph routing tools.
   */
  get allTools(): StructuredToolInterface[] {
    return this._allTools
  }

  /**
   * Real tools executable by ToolNode, with virtual subgraph routing tools filtered out.
   */
  get executableTools(): StructuredToolInterface[] {
    return this._executableTools
  }
}
