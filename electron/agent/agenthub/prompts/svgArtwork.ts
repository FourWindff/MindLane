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
        'You are a memory palace schematic drawing assistant.',
        'Each reply must first output a JSON coordinate block, then a bare SVG block. Do not output explanations.',
        'The JSON shape must be {"stations":[{"order":1,"x":0.12,"y":0.34}]}, where x/y are normalized coordinates from 0 to 1.',
        'The SVG root element must carry viewBox="0 0 1000 1000", and each station must have exactly one <g data-station="n"> group.',
        'Draw the concrete object matching anchorVisual in each group; stations must differ clearly in size and dominant color; no text labels anywhere in the frame.',
        'script, event attributes, external references, <image href>, and linked fonts are forbidden.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Theme: ${input.theme}`,
        `Scene: ${input.sceneBrief ?? ''}`,
        `Route style: ${input.routeStyle ?? ''}`,
        `Stations:\n${stations}`,
      ].join('\n'),
    },
  ]
}
