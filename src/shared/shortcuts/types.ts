/**
 * A single shortcut definition. `group` is any string; the help panel groups entries by it
 * (unknown groups are shown verbatim).
 */
export type ShortcutRegistration = {
  id: string
  /** Canonical combo, e.g. `mod+slash`, matching `eventComboFromCode` output */
  combo: string
  description: string
  group: string
  /** Whether to ignore it inside inputs, textareas, selects and contenteditables */
  preventWhenTyping: boolean
  /** Returning `false` means do not intercept (no preventDefault) */
  handler: (e: KeyboardEvent) => boolean | void
  /** Does not fire when false */
  enabled?: () => boolean
}
