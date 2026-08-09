export interface NodeSize {
  width: number
  height: number
}

const REGULAR_NODE_SIZE: NodeSize = { width: 160, height: 40 }
const PALACE_NODE_SIZE: NodeSize = { width: 260, height: 200 }

/**
 * Default size of an unmeasured node, the single source of truth for dagre
 * layout, tree geometry and edge geometry. Palace nodes are larger than
 * regular text nodes; any other / unknown type falls back to the regular size.
 */
export function defaultNodeSize(type: string | undefined): NodeSize {
  return type === 'palace' ? PALACE_NODE_SIZE : REGULAR_NODE_SIZE
}
