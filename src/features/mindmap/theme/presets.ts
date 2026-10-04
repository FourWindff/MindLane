import type {
  ColorSchemeDef,
  MindmapStyleState,
  StructureTypeDef,
  VisualVariant,
  VisualVariantDef,
} from './types'

/** Default style for a new file / an old file with no style field */
export const DEFAULT_STYLE: MindmapStyleState = {
  structureType: 'logic',
  visualVariant: 'card',
  colorScheme: 'default',
}

/** Structure axis: picks the layout algorithm only */
export const STRUCTURE_TYPES: StructureTypeDef[] = [
  {
    id: 'logic',
    label: 'Logic chart',
    description: 'All nodes expand one way, to the right of the root',
  },
  {
    id: 'mindmap',
    label: 'Mindmap',
    description: 'The root sits in the center; children expand to the left and right in turn',
  },
]

/** Visual axis: picks node style, edge style and connection mode */
export const VISUAL_VARIANTS: Record<VisualVariant, VisualVariantDef> = {
  card: {
    id: 'card',
    label: 'Card',
    description: 'Rounded card nodes with tapered bezier edges',
    edge: { path: 'bezier', stroke: 'trunk', connect: 'side', strokeWidth: 1.5 },
  },
  outline: {
    id: 'outline',
    label: 'Outline',
    description: 'Lightweight bordered nodes with smooth polylines',
    edge: { path: 'smooth-step', stroke: 'line', connect: 'side', strokeWidth: 1.5 },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description: 'Plain underlined text; right-angle branch lines join the node bottom',
    edge: { path: 'step', stroke: 'line', connect: 'bottom', strokeWidth: 2 },
  },
}

export const COLOR_SCHEMES: ColorSchemeDef[] = [
  { id: 'default', label: 'Default' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'warm', label: 'Warm Stone' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'forest', label: 'Forest' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'night', label: 'Night' },
]
