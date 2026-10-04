import { HumanMessage } from '@langchain/core/messages'

/**
 * Visual localization prompt builder.
 *
 * Because this prompt embeds an image URL for the vision model, it returns a multimodal
 * `HumanMessage` array instead of `WorkflowPromptMessage` (which carries plain-text role/content only).
 */
export function buildAnchorLocateMessages(input: {
  imageUrl: string
  anchors: Array<{ order: number; anchorVisual: string }>
}): HumanMessage[] {
  const anchorList = input.anchors
    .map((anchor) => `${anchor.order}. ${anchor.anchorVisual}`)
    .join('\n')

  const prompt = [
    'You are a precise image visual-localization assistant. Look carefully at this image and find the exact center position of the object for each visual anchor.',
    '',
    'Localization rules:',
    '1. Find the actual position of the object described by the anchor in the image, and give the x/y normalized coordinates of its visual center (a decimal between 0 and 1, precise to two decimal places).',
    '2. x goes from left (0) to right (1); y goes from top (0) to bottom (1).',
    '3. Each coordinate must point at the visual center of the object itself; do not estimate an offset.',
    '4. The distance between any two anchor coordinates must be at least 0.08; if two objects really are adjacent, just localize each to its own center.',
    '5. If an anchor is hard to identify precisely in the image, give the most reasonable position estimate; never omit it.',
    '',
    'Return strictly a JSON array with no extra text:',
    '[{"order":1,"anchorVisual":"...","x":0.12,"y":0.34}, ...]',
    '',
    'Anchor list:',
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
