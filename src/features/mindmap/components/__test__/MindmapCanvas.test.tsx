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
    MiniMap: () => <div data-testid="minimap" />,
    useOnSelectionChange: vi.fn(),
  }
})

import { MindmapCanvas } from '../MindmapCanvas'

describe('MindmapCanvas', () => {
  beforeEach(() => {
    reactFlowProps = null
  })

  it('disables all editing callbacks while disabled', () => {
    renderToString(
      <MindmapCanvas
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        edgeTypes={{}}
        disabled
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onConnect={vi.fn()}
        onSelectionChange={vi.fn()}
      />,
    )

    expect(reactFlowProps?.onNodesChange).toBeUndefined()
    expect(reactFlowProps?.onEdgesChange).toBeUndefined()
    expect(reactFlowProps?.onConnect).toBeUndefined()
    expect(reactFlowProps?.nodesDraggable).toBe(false)
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
    expect(reactFlowProps?.nodesDraggable).toBe(true)
    expect(reactFlowProps?.nodesConnectable).toBe(true)
    expect(reactFlowProps?.elementsSelectable).toBe(true)
  })

  it('only attaches the context menu handler to nodes', () => {
    const onPaneContextMenu = vi.fn()
    const onNodeContextMenu = vi.fn()

    renderToString(
      <MindmapCanvas
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        edgeTypes={{}}
        disabled={false}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionChange={vi.fn()}
      />,
    )

    const preventDefault = vi.fn()
    reactFlowProps?.onPaneContextMenu?.({ preventDefault } as never)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onPaneContextMenu).not.toHaveBeenCalled()
    expect(reactFlowProps?.onNodeContextMenu).toBe(onNodeContextMenu)
  })
})
