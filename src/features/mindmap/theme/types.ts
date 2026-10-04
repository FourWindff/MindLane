/**
 * A mindmap style is made of two independent axes:
 *   structureType (structure): logic logic chart | mindmap mindmap -- layout algorithm only
 *   visualVariant (visual): card | outline | minimal -- node/edge/spacing only
 *
 * The color scheme colorScheme is orthogonal to both.
 *
 * The persisted shape (structureType/visualVariant/colorScheme) lives in the contracts layer, in the
 * same definition as the file format; this module keeps UI descriptors only.
 */
import type { ColorSchemeId, StructureType, VisualVariant } from '@contracts/mindmapStyle'

export type {
  ColorSchemeId,
  MindmapStyleState,
  StructureType,
  VisualVariant,
} from '@contracts/mindmapStyle'

/** Edge path algorithm */
type EdgePathKind = 'bezier' | 'smooth-step' | 'step'
/** trunk = tapered filled trunk (card); line = plain stroke */
type EdgeStrokeKind = 'trunk' | 'line'
/** Where an edge joins the node: side = side midpoint; bottom = node bottom border */
export type ConnectPosition = 'side' | 'bottom'

/** Edge config of one visual variant */
interface EdgeModeConfig {
  path: EdgePathKind
  stroke: EdgeStrokeKind
  connect: ConnectPosition
  /** Stroke width in line mode; unused in trunk mode */
  strokeWidth: number
}

export interface StructureTypeDef {
  id: StructureType
  label: string
  description: string
}

export interface VisualVariantDef {
  id: VisualVariant
  label: string
  description: string
  edge: EdgeModeConfig
}

export interface ColorSchemeDef {
  id: ColorSchemeId
  label: string
  /** Representative color shown in the color picker */
}
