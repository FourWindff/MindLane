/**
 * Persisted map style shape: the `structureType` / `visualVariant` /
 * `colorScheme` triple stored in the file's `<style>` element. The UI
 * descriptors for these ids live with the mindmap feature's theme module.
 */

export type StructureType = 'logic' | 'mindmap'
export type VisualVariant = 'card' | 'outline' | 'minimal'

/** Color scheme */
export type ColorSchemeId = 'default' | 'rainbow' | 'warm' | 'ocean' | 'forest' | 'sunset' | 'night'

export interface MindmapStyleState {
  structureType: StructureType
  visualVariant: VisualVariant
  colorScheme: ColorSchemeId
}
