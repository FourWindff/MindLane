import fs from 'node:fs/promises'
import path from 'node:path'
import { isWithinWorkspace } from '../../fs/paths.js'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'

// Max lines returned per call; beyond this the result is truncated.
const MAX_LINES = 2000
// Max characters per line; longer lines are truncated inline.
const MAX_LINE_CHARS = 2000

interface ReadFileOk {
  ok: true
  path: string
  totalLines: number
  startLine: number
  endLine: number
  truncated: boolean
  content: string
}

interface ReadFileError {
  ok: false
  error: string
}

type ReadFileResult = ReadFileOk | ReadFileError

function fail(error: string): ReadFileError {
  return { ok: false, error }
}

/**
 * Create the readFile tool. The workspace root is injected via a getter so the
 * tool stays stateless and unit-testable; the getter is evaluated per call so
 * workspace switches take effect without rebuilding the registry.
 */
export function createReadFileTool(getWorkspacePath: () => string) {
  return tool(
    async ({ path: inputPath, start, end }): Promise<ReadFileResult> => {
      const workspaceRoot = getWorkspacePath()
      if (!workspaceRoot) {
        return fail('No workspace is open, cannot read files')
      }

      if (start !== undefined && start < 1) {
        return fail(`Invalid start line ${start}: lines are 1-based`)
      }
      if (end !== undefined && end < (start ?? 1)) {
        return fail(`Invalid line range: end (${end}) cannot be less than start (${start ?? 1})`)
      }

      // Resolve first, then check the boundary, so `../` cannot escape.
      const resolved = path.resolve(workspaceRoot, inputPath)

      if (!isWithinWorkspace(resolved, path.resolve(workspaceRoot))) {
        // Echo only the user-supplied path, never the resolved absolute path.
        return fail(`Path "${inputPath}" is outside the workspace, read refused`)
      }

      let buffer: Buffer
      try {
        const stat = await fs.stat(resolved)
        if (stat.isDirectory()) {
          return fail(`Path "${inputPath}" is a directory, not a file`)
        }
        buffer = await fs.readFile(resolved)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return fail(`File "${inputPath}" does not exist, check the path`)
        }
        // Do not interpolate err.message: fs errors embed the resolved
        // absolute path, which must not leak into agent context.
        return fail(`Failed to read file "${inputPath}"`)
      }

      // NUL byte sniff: treat as binary and refuse, so context is not flooded
      // with mojibake.
      if (buffer.includes(0)) {
        return fail(`File "${inputPath}" is binary and cannot be read as text`)
      }

      const lines = buffer.toString('utf8').split('\n')
      const totalLines = lines.length

      const startLine = start ?? 1
      if (startLine > totalLines) {
        // Reading past EOF is not an error: empty content lets the agent sense
        // the file boundary naturally.
        return {
          ok: true,
          path: inputPath,
          totalLines,
          startLine,
          endLine: totalLines,
          truncated: false,
          content: '',
        }
      }

      let endLine = Math.min(end ?? totalLines, totalLines)
      let truncated = false
      if (endLine - startLine + 1 > MAX_LINES) {
        endLine = startLine + MAX_LINES - 1
        truncated = true
      }

      const body = lines
        .slice(startLine - 1, endLine)
        .map((line, i) => {
          const lineNo = startLine + i
          const text =
            line.length > MAX_LINE_CHARS
              ? `${line.slice(0, MAX_LINE_CHARS)} …[line truncated, ${line.length} chars total]`
              : line
          return `${lineNo}→${text}`
        })
        .join('\n')

      const content = truncated
        ? `${body}\n[Output truncated: the file has ${totalLines} lines; this call returned lines ${startLine}-${endLine}, use start=${endLine + 1} to continue]`
        : body

      return { ok: true, path: inputPath, totalLines, startLine, endLine, truncated, content }
    },
    {
      name: 'readFile',
      description:
        'Read the contents of a text file inside the workspace. path may be a relative path from the workspace root or an absolute path inside the workspace; start/end are a 1-based inclusive line range, omit them to read the whole file (over 2000 lines is truncated). The returned content prefixes every line with its line number and includes the file total line count. Only text files inside the workspace can be read.',
      schema: z.object({
        path: z
          .string()
          .describe('File path (relative to the workspace root, or absolute inside the workspace)'),
        start: z.number().int().optional().describe('Start line (1-based, optional)'),
        end: z.number().int().optional().describe('End line (1-based, inclusive, optional)'),
      }),
    },
  )
}
