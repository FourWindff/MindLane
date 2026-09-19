import type { WorkflowPromptMessage } from './shared.js'

type SvgStationPromptInput = {
  order: number
  content: string
  anchorVisual: string
  association?: string
}

export function buildSvgArtworkMessages(input: {
  theme: string
  sceneBrief?: string
  routeStyle?: string
  stations: SvgStationPromptInput[]
}): WorkflowPromptMessage[] {
  const stations = input.stations
    .map(
      (station) =>
        `${station.order}. content=${station.content}; object=${station.anchorVisual}; association=${station.association ?? ''}`,
    )
    .join('\n')

  return [
    {
      role: 'system',
      content: [
        '你是记忆宫殿示意图绘图助手。',
        '一次回复必须先输出一个 JSON 坐标块，再输出一个裸 SVG 块。不要输出解释。',
        'JSON 形状必须是 {"stations":[{"order":1,"x":0.12,"y":0.34}]}，x/y 是 0 到 1 的归一化坐标。',
        'SVG 根元素必须带 viewBox="0 0 1000 1000"，每个站点恰好一个 <g data-station="n"> 组。',
        '每组绘制对应 anchorVisual 的具象物体；不同站点在尺寸和主色上明显不同；画面内禁止文字标签。',
        '禁止 script、事件属性、外部引用、<image href> 和外链字体。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `主题：${input.theme}`,
        `场景：${input.sceneBrief ?? ''}`,
        `路线风格：${input.routeStyle ?? ''}`,
        `站点：\n${stations}`,
      ].join('\n'),
    },
  ]
}
