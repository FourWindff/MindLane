import { HumanMessage } from '@langchain/core/messages'

/**
 * 视觉定位提示词构造。
 *
 * 由于该 prompt 需要嵌入图片 URL 给视觉模型，返回多模态 `HumanMessage` 数组，
 * 而非 `WorkflowPromptMessage`（后者只承载纯文本 role/content）。
 */
export function buildAnchorLocateMessages(input: {
  imageUrl: string
  anchors: Array<{ order: number; anchorVisual: string }>
}): HumanMessage[] {
  const anchorList = input.anchors
    .map((anchor) => `${anchor.order}. ${anchor.anchorVisual}`)
    .join('\n')

  const prompt = [
    '你是精确的图片视觉定位助手。请仔细查看这张图片，找到每个视觉锚点对应物体的精确中心位置。',
    '',
    '定位规则：',
    '1. 找到锚点描述的物体在图中的实际位置，给出其视觉中心的 x/y 归一化坐标（0 到 1 之间的小数，精确到小数点后两位）。',
    '2. x 表示从左（0）到右（1），y 表示从上（0）到下（1）。',
    '3. 每个坐标必须定位到该物体本身的视觉中心，不要估算偏移。',
    '4. 任意两个锚点的坐标距离应不小于 0.08；如果两个物体确实紧挨，分别定位到各自物体的中心即可。',
    '5. 如果某个锚点在图中不容易精确识别，给出最合理的位置估计，不要省略。',
    '',
    '严格返回 JSON 数组，不要输出任何额外文字：',
    '[{"order":1,"anchorVisual":"...","x":0.12,"y":0.34}, ...]',
    '',
    '锚点列表：',
    anchorList,
  ].join('\n')

  return [
    new HumanMessage({
      content: [
        { type: 'image_url', image_url: { url: input.imageUrl } },
        { type: 'text', text: prompt },
      ],
    }),
  ]
}
