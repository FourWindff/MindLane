import type { WorkflowPromptMessage } from './shared.js'

type MemoryItemPromptInput = {
  order: number
  content: string
}

type PalaceStationPromptInput = {
  order: number
  content: string
  anchorVisual?: string
  mnemonicMethod?: string
  association?: string
}

export function buildAnalyzeInputMessages(conversation: string): WorkflowPromptMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是记忆材料拆解助手。',
        '请根据对话上下文，提取用户当前这一轮真正要记忆的内容。',
        '把内容拆成有序条目，每条必须是可记忆的具体信息点。',
        '不要生成画面、不要解释，只返回结构化结果。',
        '如果用户给的是清单、知识点、定义、单词、流程，都要拆成顺序明确的 items。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `对话上下文：\n${conversation}\n\n请拆解用户最新要记忆的内容。`,
    },
  ]
}

export function buildDesignMnemonicsMessages(
  items: MemoryItemPromptInput[],
): WorkflowPromptMessage[] {
  const itemsText = items.map((item) => `${item.order}. ${item.content}`).join('\n')
  return [
    {
      role: 'system',
      content: [
        '你是记忆宫殿设计师。',
        '请为用户设计一个单张图可承载的记忆宫殿场景。',
        '每个站点都必须包含：content、anchorVisual、mnemonicMethod、association。',
        'anchorVisual 必须是图片里能直接看到的具体物体或局部场景。',
        'mnemonicMethod 要指出助记方法，例如谐音、夸张、故事、动作、形状联想。',
        'association 要简洁说明为什么这个锚点能帮助回忆 content。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `请为以下条目设计记忆宫殿：\n${itemsText}`,
    },
  ]
}

export function buildImagePromptGeneratorMessages(input: {
  theme: string
  stations: PalaceStationPromptInput[]
}): WorkflowPromptMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是记忆宫殿文生图提示词工程师。',
        '请把记忆宫殿设计转换成单张图片提示词。',
        '要求：一条连续通道；锚点按顺序排布；画面中无文字；每个锚点互不混淆；风格清晰。',
        '只输出提示词，不要加标题和解释。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `场景主题：${input.theme}`,
        `总站点数：${input.stations.length}`,
        ...input.stations.map(
          (station) =>
            `第 ${station.order} 站：内容=${station.content}；画面锚点=${station.anchorVisual}；联想=${station.association ?? ''}`,
        ),
      ].join('\n'),
    },
  ]
}

export function buildSummaryMessages(input: {
  theme: string
  hasImage: boolean
  memoryRoute: PalaceStationPromptInput[]
}): WorkflowPromptMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是记忆宫殿讲解助手。',
        '请用简洁中文说明如何沿路线回忆。',
        '每个站点都要点出：位置顺序、内容、助记法。',
        '控制在 6-12 句，不要使用表格。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `场景主题：${input.theme}`,
        `是否已生成图片：${input.hasImage ? '是' : '否'}`,
        ...input.memoryRoute.map(
          (station) =>
            `第 ${station.order} 站：内容=${station.content}；画面=${station.anchorVisual ?? ''}；助记法=${station.mnemonicMethod ?? ''}；关联=${station.association ?? ''}`,
        ),
      ].join('\n'),
    },
  ]
}
