import fs from 'node:fs/promises'
import path from 'node:path'
import { runMindmapWorkflow } from '../lab/mindmapworkflow.js'
import type { AnthropicLabConfig, MindmapWorkflowResult } from '../lab/mindmapworkflow.js'

export type MindmapGenerationPhase =
  | 'preparing'
  | 'extracting'
  | 'merging'
  | 'finalizing'
  | 'done'
  | 'error'

export interface MindmapGenerationProgress {
  phase: MindmapGenerationPhase
  filename: string
  message?: string
  error?: string
}

export interface MindmapGenerationResult {
  yamlContent: string
  yamlPath: string
  logPath: string
  documentTitle: string
  pageCount: number
}

export interface MindmapGenerationOptions {
  filePath: string
  config: AnthropicLabConfig
  onProgress?: (progress: MindmapGenerationProgress) => void
}

const SUPPORTED_EXTENSIONS = ['.pdf']

export class MindmapGenerationError extends Error {
  constructor(message: string, readonly phase: MindmapGenerationPhase = 'error') {
    super(message)
    this.name = 'MindmapGenerationError'
  }
}

export async function generateFromFile(
  options: MindmapGenerationOptions,
): Promise<MindmapGenerationResult> {
  const { filePath, config, onProgress } = options
  const filename = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase()

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new MindmapGenerationError(`仅支持 PDF 文件，收到 ${ext || '未知扩展名'}`)
  }

  if (!config.apiKey?.trim()) {
    throw new MindmapGenerationError('未配置 API Key')
  }

  try {
    await fs.access(filePath)
  } catch {
    throw new MindmapGenerationError(`找不到文件: ${filePath}`)
  }

  const emit = (progress: MindmapGenerationProgress) => {
    if (onProgress) onProgress(progress)
  }

  emit({ phase: 'preparing', filename, message: '准备文件' })

  const effectiveConfig: AnthropicLabConfig = {
    ...config,
    pdfPath: filePath,
  }

  let workflowResult: MindmapWorkflowResult
  try {
    emit({ phase: 'extracting', filename, message: '提取 PDF 内容并生成树状大纲' })
    workflowResult = await runMindmapWorkflow(effectiveConfig)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ phase: 'error', filename, error: message })
    throw new MindmapGenerationError(`Lab 工作流执行失败: ${message}`)
  }

  emit({ phase: 'merging', filename, message: '合并子树' })
  emit({ phase: 'finalizing', filename, message: '生成 YAML' })

  let yamlContent: string
  try {
    yamlContent = await fs.readFile(workflowResult.yamlPath, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ phase: 'error', filename, error: message })
    throw new MindmapGenerationError(`无法读取生成的 YAML: ${message}`)
  }

  emit({ phase: 'done', filename, message: '生成完成' })

  return {
    yamlContent,
    yamlPath: workflowResult.yamlPath,
    logPath: workflowResult.logPath,
    documentTitle: workflowResult.documentTitle,
    pageCount: workflowResult.pageCount,
  }
}
