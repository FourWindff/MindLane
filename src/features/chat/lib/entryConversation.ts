import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { useWorkspaceStore } from '@/app/workspace/store'
import type { DocumentRef } from '@/shared/lib/fileFormat'

/**
 * Entry conversation (CONTEXT.md「入口对话」): with no file open the send box is
 * still usable — sending creates and opens its own `.mindlane` file first, and
 * that turn becomes the file's first round.
 *
 * Order is create → open → wait for the editor → start the stream: the file must
 * be loaded into the registry before the stream starts, otherwise a write landing
 * in the first turn would have no editor to accept it.
 */

/** Cap for the file name derived from user input (Chinese titles are 3 bytes per char). */
const MAX_TITLE_LENGTH = 60
/** Illegal in file names on at least one supported platform. */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g
/** Trailing extension of a plausible document name (`报告.pdf` → `报告`, `example.com/a` stays). */
const TRAILING_EXTENSION = /\.[A-Za-z0-9]{1,5}$/

/**
 * Placeholder title of an entry file: the attachment name, or the first line of
 * the input. Sanitized so it is always usable as a file name.
 */
export function entryFileTitle(text: string, document: DocumentRef | null): string {
  const source = document ? document.filename.replace(TRAILING_EXTENSION, '') : text
  const cleaned = source
    .split('\n')[0]!
    .replace(ILLEGAL_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, MAX_TITLE_LENGTH) || '未命名'
}

interface EntryFile {
  fileUuid: string
  filePath: string
}

/** Files created by an entry turn, so only those may have their title backfilled. */
const entryFileUuids = new Set<string>()

/**
 * Creates and opens the `.mindlane` file an entry turn belongs to.
 *
 * Returns the identity of the file once the editor is ready (the registry holds
 * the instance), or null when the workspace cannot create it.
 */
export async function createEntryFile(
  text: string,
  document: DocumentRef | null,
): Promise<EntryFile | null> {
  const workspace = useWorkspaceStore.getState()
  if (!workspace.workspacePath) return null
  if (
    !(await workspace.createMindlaneFile(entryFileTitle(text, document), undefined, {
      uniqueName: true,
    }))
  ) {
    return null
  }
  const active = mindmapRegistry.getActiveFile()
  if (!active) return null
  entryFileUuids.add(active.fileUuid)
  return { fileUuid: active.fileUuid, filePath: active.filePath }
}

/**
 * Backfills a generated map title onto the file an entry turn created — both the
 * file name (what the file list shows) and the document title. Files the entry
 * turn did not create are never renamed.
 */
export function backfillEntryFileTitle(fileUuid: string, title: string): void {
  if (!entryFileUuids.has(fileUuid)) return
  const instance = mindmapRegistry.getByFileUuid(fileUuid)
  const filePath = instance?.store.getState().filePath
  if (!instance || !filePath) return
  entryFileUuids.delete(fileUuid)

  const name = entryFileTitle(title, null)
  instance.store.getState().setFileTitle(name)
  const currentName = filePath
    .split(/[\\/]/)
    .pop()!
    .replace(/\.mindlane$/, '')
  if (currentName === name) return
  void useWorkspaceStore.getState().renameItem(filePath, name)
}
