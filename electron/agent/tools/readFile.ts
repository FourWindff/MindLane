import fs from 'node:fs/promises'
import path from 'node:path'
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

function isWithinWorkspace(resolvedPath: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, resolvedPath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
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
        return fail('当前没有打开的工作区，无法读取文件')
      }

      if (start !== undefined && start < 1) {
        return fail(`无效的起始行号 ${start}：行号从 1 开始`)
      }
      if (end !== undefined && end < (start ?? 1)) {
        return fail(`无效的行号范围：end（${end}）不能小于 start（${start ?? 1}）`)
      }

      // Resolve first, then check the boundary, so `../` cannot escape.
      const resolved = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(workspaceRoot, inputPath)

      if (!isWithinWorkspace(resolved, path.resolve(workspaceRoot))) {
        // Echo only the user-supplied path, never the resolved absolute path.
        return fail(`路径 "${inputPath}" 不在工作区内，已拒绝读取`)
      }

      let buffer: Buffer
      try {
        const stat = await fs.stat(resolved)
        if (stat.isDirectory()) {
          return fail(`路径 "${inputPath}" 是一个目录，不是文件`)
        }
        buffer = await fs.readFile(resolved)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return fail(`文件 "${inputPath}" 不存在，请检查路径是否正确`)
        }
        // Do not interpolate err.message: fs errors embed the resolved
        // absolute path, which must not leak into agent context.
        return fail(`读取文件 "${inputPath}" 失败`)
      }

      // NUL byte sniff: treat as binary and refuse, so context is not flooded
      // with mojibake.
      if (buffer.includes(0)) {
        return fail(`文件 "${inputPath}" 是二进制文件，无法作为文本读取`)
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
              ? `${line.slice(0, MAX_LINE_CHARS)} …[本行已截断，共 ${line.length} 字符]`
              : line
          return `${lineNo}→${text}`
        })
        .join('\n')

      const content = truncated
        ? `${body}\n[输出已截断：文件共 ${totalLines} 行，本次返回第 ${startLine}-${endLine} 行，可用 start=${endLine + 1} 继续读取]`
        : body

      return { ok: true, path: inputPath, totalLines, startLine, endLine, truncated, content }
    },
    {
      name: 'readFile',
      description:
        '读取工作区内文本文件的内容。path 可以是相对工作区根目录的相对路径或工作区内的绝对路径；start/end 为 1-based 行号闭区间，省略则读取全文（超过 2000 行会被截断）。返回内容每行带行号前缀，并附文件总行数。只能读取工作区内的文本文件。',
      schema: z.object({
        path: z.string().describe('文件路径（相对工作区根目录，或工作区内的绝对路径）'),
        start: z.number().int().optional().describe('起始行号（1-based，可选）'),
        end: z.number().int().optional().describe('结束行号（1-based 闭区间，可选）'),
      }),
    },
  )
}
