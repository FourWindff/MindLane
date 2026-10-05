import type { WorkflowPromptMessage } from './shared.js'
import type { RouteStyle } from '../palaceLayout.js'

type SelectedNodePromptInput = {
  id: string
  label: string
}

type PalaceAnchorPromptInput = {
  order: number
  content: string
  anchorVisual: string
  association?: string
}

type PalaceImagePromptInput = {
  theme: string
  sceneBrief: string
  routeStyle: RouteStyle
  stations: PalaceAnchorPromptInput[]
}

export function buildAnalyzeAndPlanMessages(
  selectedNodes: SelectedNodePromptInput[],
): WorkflowPromptMessage[] {
  const nodeList = selectedNodes
    .map((node, index) => `${index + 1}. [${node.id}] ${node.label}`)
    .join('\n')

  return [
    {
      role: 'system',
      content: `You are a memory palace planner. The user gives you a set of knowledge-point nodes, and you design a unified, coherent, walkable memory palace around them.

Core rules:
1. Use every node, each exactly once. linked_node_id must come strictly from the node IDs the user provides.
2. content must keep the same meaning as the original node; only very light compression is allowed, never rewriting or replacing it with unrelated content.
3. theme must be a concrete, vivid physical space (such as "undersea coral palace", "steampunk clockwork workshop", "magical forest treehouse"); abstract names like "memory palace" are forbidden.
4. scene_brief describes the space's concrete appearance and atmosphere in one sentence (such as "a Victorian workshop packed with copper pipes and gears, steam drifting through cracks in the ceiling").
5. route_style must be one of arc, s_curve, zigzag, loop, stairs.

anchor_visual requirements (extremely important; they directly determine image quality):
- Must be a real, visible, large-scale object or scene fragment with a clear silhouette.
- Good examples: "a giant alchemist furnace blazing with blue fire", "a stone archway overgrown with vines", "a huge rotating waterwheel", "a giant hanging crystal ball".
- Bad examples: "a formula", "the E=mc² symbol", "a paragraph of text", "a concept diagram" - none of these can be drawn.
- Never use abstract elements that cannot be rendered directly by painting, such as text, symbols, formulas, numbers, or arrows.
- Anchors must differ noticeably in object type, silhouette size, and dominant color; avoid sameness (for example, not two "bookshelves" or two "bottles").
- Anchors must plausibly exist in the space described by theme.

visual_bridge: one sentence explaining why this concrete anchor evokes the node content (homophone, similar shape, functional metaphor, story association, etc.).

Output strictly a JSON object with no extra text:
{
  "theme": "concrete scene name",
  "scene_brief": "one sentence describing the space's appearance and atmosphere",
  "route_style": "arc",
  "stations": [
    {
      "order": 1,
      "linked_node_id": "node-id",
      "content": "content identical to the original node",
      "anchor_visual": "concrete large-scale visible object, such as a giant alchemist furnace blazing with blue fire",
      "visual_bridge": "the associative bridge between this object and the node content",
      "association": "a brief note on how the anchor helps recall the node content"
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `Design a memory palace route for the following ${selectedNodes.length} knowledge points:\n${nodeList}`,
    },
  ]
}

function describeRouteStyle(routeStyle: RouteStyle): string {
  switch (routeStyle) {
    case 'arc':
      return 'arc'
    case 's_curve':
      return 'S-shaped curve'
    case 'zigzag':
      return 'zigzag polyline'
    case 'loop':
      return 'loop'
    case 'stairs':
      return 'staircase'
  }
}

function assignSpatialZones(count: number): string[] {
  if (count <= 0) return []
  if (count === 1) return ['dead center of the frame']
  if (count === 2) return ['left side of the frame', 'right side of the frame']
  if (count === 3)
    return ['front left of the frame', 'dead center of the frame', 'back right of the frame']
  if (count === 4)
    return [
      'front left of the frame',
      'front right of the frame',
      'back left of the frame',
      'back right of the frame',
    ]
  if (count === 5)
    return [
      'far left of the frame',
      'front left of the frame',
      'center of the frame',
      'back right of the frame',
      'far right of the frame',
    ]

  const LARGE_ZONES = [
    'front-left foreground',
    'front-right foreground',
    'left midground',
    'dead center',
    'right midground',
    'rear-left background',
    'rear-right background',
    'distant center',
    'upper left',
  ]
  return Array.from({ length: count }, (_, i) => LARGE_ZONES[i % LARGE_ZONES.length])
}

export function buildPalaceImagePrompt(input: PalaceImagePromptInput): string {
  const n = input.stations.length
  const zones = assignSpatialZones(n)
  const compact = n > 6

  const anchorDescs = input.stations.map((station, i) => {
    const zone = zones[i]
    if (compact) {
      return `- ${zone}: ${station.anchorVisual}`
    }
    return `- ${zone} holds ${station.anchorVisual}`
  })

  return [
    `CG concept-art style, one complete bird's-eye view of the scene. ${input.sceneBrief}.`,
    `Along the ${describeRouteStyle(input.routeStyle)} route, ${n} striking and distinct landmarks are arranged with clear spacing and no overlap:`,
    ...anchorDescs,
    `Bright, clear image with rich color and a strong sense of depth. Each landmark occupies its own area of the frame at a conspicuous, recognizable size.`,
    `Absolutely no text, labels, numbers, arrows, or callout boxes may appear.`,
  ].join('\n')
}
