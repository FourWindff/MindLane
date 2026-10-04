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
        'You are a memory-material decomposition assistant.',
        'Based on the conversation context, extract what the user actually wants to memorize in this turn.',
        'Break the content into ordered items; each item must be a concrete, memorable piece of information.',
        'Do not generate imagery and do not explain; return only the structured result.',
        'Lists, knowledge points, definitions, vocabulary words, and processes must all be broken into items with a clear order.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Conversation context:\n${conversation}\n\nBreak down what the user most recently wants to memorize.`,
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
        'You are a memory palace designer.',
        'Design a memory palace scene that a single image can carry for the user.',
        'Every station must include: content, anchorVisual, mnemonicMethod, association.',
        'anchorVisual must be a concrete object or scene fragment directly visible in the image.',
        'mnemonicMethod must name the mnemonic technique, such as homophone, exaggeration, story, action, or shape association.',
        'association must briefly explain why this anchor helps recall the content.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Design a memory palace for the following items:\n${itemsText}`,
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
        'You are a memory palace text-to-image prompt engineer.',
        'Convert the memory palace design into a single-image prompt.',
        'Requirements: one continuous pathway; anchors arranged in order; no text in the frame; anchors clearly distinct from one another; clean style.',
        'Output only the prompt, with no title and no explanation.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Scene theme: ${input.theme}`,
        `Total stations: ${input.stations.length}`,
        ...input.stations.map(
          (station) =>
            `Station ${station.order}: content=${station.content}; visual anchor=${station.anchorVisual}; association=${station.association ?? ''}`,
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
        'You are a memory palace walkthrough assistant.',
        'Explain in concise English how to recall along the route.',
        'Each station must mention: position order, content, and mnemonic technique.',
        'Keep it to 6-12 sentences; do not use tables.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Scene theme: ${input.theme}`,
        `Image generated: ${input.hasImage ? 'yes' : 'no'}`,
        ...input.memoryRoute.map(
          (station) =>
            `Station ${station.order}: content=${station.content}; visual=${station.anchorVisual ?? ''}; mnemonic=${station.mnemonicMethod ?? ''}; association=${station.association ?? ''}`,
        ),
      ].join('\n'),
    },
  ]
}
