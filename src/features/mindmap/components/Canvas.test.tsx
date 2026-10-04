import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { ReactFlow } from '@xyflow/react'

let reactFlowProps: ComponentProps<typeof ReactFlow> | null = null

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return {
    ...actual,
    ReactFlow: (props: ComponentProps<typeof ReactFlow>) => {
      reactFlowProps = props
      return <div data-testid="react-flow">{props.children}</div>
    },
    Controls: () => <div data-testid="controls" />,
    useOnSelectionChange: vi.fn(),
  }
})

import { MindmapCanvas } from './Canvas'

describe('MindmapCanvas', () => {
  beforeEach(() => {
    reactFlowProps = null
  })

  it('keeps onNodesChange wired while disabled so dimensions still reach the editor', () => {
    const onNodesChange = vi.fn()
    renderToString(
      <MindmapCanvas
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        edgeTypes={{}}
        disabled
        onNodesChange={onNodesChange}
        onEdgesChange={vi.fn()}
        onConnect={vi.fn()}
        onSelectionChange={vi.fn()}
      />,
    )

    // Node dimension measurements must flow during an AI stream or edges stay
    // connected at stale default sizes; only interaction callbacks are cut.
    expect(reactFlowProps?.onNodesChange).toBe(onNodesChange)
    expect(reactFlowProps?.onEdgesChange).toBeUndefined()
    expect(reactFlowProps?.onConnect).toBeUndefined()
    expect(reactFlowProps?.nodesDraggable).toBe(false)
    // Pure-tree constraint (ADR-0015): every connect entry point is removed, connecting is never enabled
    expect(reactFlowProps?.nodesConnectable).toBe(false)
    expect(reactFlowProps?.elementsSelectable).toBe(false)
  })

  it('forwards editing callbacks when enabled', () => {
    const onNodesChange = vi.fn()
    const onEdgesChange = vi.fn()
    const onConnect = vi.fn()

    renderToString(
      <MindmapCanvas
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        edgeTypes={{}}
        disabled={false}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(reactFlowProps?.onNodesChange).toBe(onNodesChange)
    expect(reactFlowProps?.onEdgesChange).toBe(onEdgesChange)
    expect(reactFlowProps?.onConnect).toBe(onConnect)
    expect(reactFlowProps?.nodesDraggable).toBe(false)
    // Pure-tree constraint: even when onConnect is passed, connecting stays off (the entry point is gone)
    expect(reactFlowProps?.nodesConnectable).toBe(false)
    expect(reactFlowProps?.elementsSelectable).toBe(true)
  })

  it('attaches the context menu handler to nodes', () => {
    const onNodeContextMenu = vi.fn()

    renderToString(
      <MindmapCanvas
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        edgeTypes={{}}
        disabled={false}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(reactFlowProps?.onNodeContextMenu).toBe(onNodeContextMenu)
  })
})
