import type { WorkflowPromptMessage } from './shared.js'

type SelectedNodePromptInput = {
  id: string
  label: string
}

export type NodesPalaceRouteStyle = 'arc' | 's_curve' | 'zigzag' | 'loop' | 'stairs'

type PalaceAnchorPromptInput = {
  order: number
  content: string
  anchorVisual: string
  association?: string
}

type PalaceImagePromptInput = {
  theme: string
  sceneBrief: string
  routeStyle: NodesPalaceRouteStyle
  stations: PalaceAnchorPromptInput[]
}

export function buildAnalyzeAndPlanMessages(
  selectedNodes: SelectedNodePromptInput[],
): WorkflowPromptMessage[] {
  const nodeList = selectedNodes.map((node, index) => `${index + 1}. [${node.id}] ${node.label}`).join('\n')

  return [
    {
      role: 'system',
      content: `你是记忆宫殿规划师。用户会给你一组知识点节点，你要围绕它们设计一个统一、连贯、可走访的记忆宫殿。

核心规则：
1. 必须使用全部节点，每个节点恰好出现一次。linked_node_id 必须严格来自用户提供的节点 ID。
2. content 必须与原节点语义保持一致，只允许极轻微压缩，不允许改写或替换为无关内容。
3. theme 必须是一个具体的、有画面感的实体空间（如"海底珊瑚宫殿"、"蒸汽朋克钟表工坊"、"魔法森林树屋"），禁止使用"记忆宫殿"等抽象名称。
4. scene_brief 用一句话描述该空间的具体样貌和氛围（如"一间布满铜管和齿轮的维多利亚风格工坊，蒸汽从天花板缝隙中弥漫"）。
5. route_style 只能从 arc、s_curve、zigzag、loop、stairs 中选一个。

anchor_visual 要求（极其重要，直接决定生成图片质量）：
- 必须是真实可见、有明确外形轮廓的大尺度物体或场景局部。
- 好的例子："冒着蓝色火焰的巨型炼金炉"、"缠满藤蔓的石拱门"、"旋转的巨大水车"、"悬挂的巨型水晶球"。
- 坏的例子："一个公式"、"E=mc²符号"、"一段文字"、"一个概念图"——这些无法被画出来。
- 禁止使用文字、符号、公式、数字、箭头等无法被绘画直接表现的抽象元素。
- 各锚点之间必须在物体类型、外形尺寸、主色调上有显著差异，避免同质化（如不能两个都是"书架"或两个都是"瓶子"）。
- 锚点必须合理地存在于 theme 所描述的空间中。

visual_bridge：一句话解释该具象锚点为什么能联想到节点内容（谐音、形状类似、功能隐喻、故事联想等）。

请严格输出 JSON 对象，不要有任何额外文字：
{
  "theme": "具体空间场景名",
  "scene_brief": "一句话描述空间的样貌和氛围",
  "route_style": "arc",
  "stations": [
    {
      "order": 1,
      "linked_node_id": "node-id",
      "content": "与原节点一致的内容",
      "anchor_visual": "具体大尺度可见物体，如冒着蓝色火焰的巨型炼金炉",
      "visual_bridge": "该物体与节点内容的联想桥梁",
      "association": "锚点帮助记忆节点内容的简要说明"
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `请为以下 ${selectedNodes.length} 个知识点设计记忆宫殿路线：\n${nodeList}`,
    },
  ]
}

function describeRouteStyle(routeStyle: NodesPalaceRouteStyle): string {
  switch (routeStyle) {
    case 'arc':
      return '弧线'
    case 's_curve':
      return 'S形曲线'
    case 'zigzag':
      return '锯齿形折线'
    case 'loop':
      return '环形'
    case 'stairs':
      return '阶梯式'
  }
}

function assignSpatialZones(count: number): string[] {
  if (count <= 0) return []
  if (count === 1) return ['画面正中央']
  if (count === 2) return ['画面左侧', '画面右侧']
  if (count === 3) return ['画面左前方', '画面正中央', '画面右后方']
  if (count === 4) return ['画面左前方', '画面右前方', '画面左后方', '画面右后方']
  if (count === 5) return ['画面最左侧', '画面左前方', '画面正中', '画面右后方', '画面最右侧']

  const LARGE_ZONES = [
    '画面左前近景',
    '画面右前近景',
    '画面左侧中景',
    '画面正中央',
    '画面右侧中景',
    '画面左后远景',
    '画面右后远景',
    '画面远处正中',
    '画面高处偏左',
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
      return `- ${zone}：${station.anchorVisual}`
    }
    return `- ${zone}放置着${station.anchorVisual}`
  })

  return [
    `CG概念艺术风格，单张完整场景俯瞰图。${input.sceneBrief}。`,
    `场景中沿${describeRouteStyle(input.routeStyle)}路线分布着 ${n} 个醒目且各不相同的标志物，彼此间距明显、互不重叠：`,
    ...anchorDescs,
    `画面明亮清晰，色彩丰富，空间纵深感强。每个标志物在画面中占据独立区域，尺寸醒目便于辨认。`,
    `绝对不要出现任何文字、标签、数字、箭头或说明框。`,
  ].join('\n')
}
