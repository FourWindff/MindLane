/** Basename of a document path without the `.mindlane` extension, for display only. */
export function displayFileName(filePath: string): string {
  return filePath
    .split(/[/\\]/)
    .pop()!
    .replace(/\.mindlane$/, '')
}
