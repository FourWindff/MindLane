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
        'You are a memory palace scene illustrator.',
        'Reply with exactly one bare SVG block and no explanation.',
        'The SVG root element must carry viewBox="0 0 1000 1000".',
        'Draw one continuous scene: a single walkable route past the concrete objects listed below, in order.',
        'The artwork is decorative background only: never draw station numbers, markers, labels, text, arrows, or callout boxes.',
        'Stations must differ clearly in size and dominant color; no two objects may overlap completely.',
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
