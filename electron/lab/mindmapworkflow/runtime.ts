import { ChatAnthropic } from '@langchain/anthropic'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadPdfPages } from './io.js'
import { LabLogger } from './logger.js'
import type {
  AnthropicLabConfig,
  ChatModelLike,
  NormalizedAnthropicLabConfig,
  WorkflowDependencies,
  WorkflowRuntime,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'output')
let runtimeSequence = 0

export function createRuntime(
  config: AnthropicLabConfig,
  dependencies: WorkflowDependencies,
): WorkflowRuntime {
  const normalizedConfig = normalizeConfig(config)
  const now = dependencies.now ?? (() => new Date())
  const runStartedAt = now()
  const pdfStem = path.basename(
    normalizedConfig.pdfPath,
    path.extname(normalizedConfig.pdfPath),
  )
  const runId = createRunId(runStartedAt)
  const artifacts = {
    yamlPath: path.join(normalizedConfig.outputDir, `${pdfStem}.${runId}.mindmap.yaml`),
    logPath: path.join(normalizedConfig.outputDir, `${pdfStem}.${runId}.run.log`),
  }

  return {
    config: normalizedConfig,
    model: dependencies.model ?? createChatModel(normalizedConfig),
    logger: new LabLogger(artifacts.logPath, normalizedConfig.debug),
    pdfLoader: dependencies.pdfLoader ?? loadPdfPages,
    now,
    artifacts,
  }
}

function createChatModel(config: NormalizedAnthropicLabConfig): ChatModelLike {
  return new ChatAnthropic({
    model: config.model,
    anthropicApiKey: config.apiKey,
    temperature: 0.2,
    maxRetries: 2,
    clientOptions: {
      baseURL: config.baseUrl,
    },
  })
}

function normalizeConfig(
  config: AnthropicLabConfig,
): NormalizedAnthropicLabConfig {
  const pdfPath = config.pdfPath.trim()
  if (!pdfPath) {
    throw new Error('pdfPath 不能为空')
  }
  return {
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
    pdfPath,
    outputDir: config.outputDir?.trim() || DEFAULT_OUTPUT_DIR,
    chunkCharLimit: config.chunkCharLimit ?? 7000,
    concurrency: config.concurrency ?? 4,
    leafChunkGroupSize: config.leafChunkGroupSize ?? 1,
    mergeBatchSize: config.mergeBatchSize ?? 8,
    maxChunks: config.maxChunks ?? Infinity,
    debug: config.debug ?? false,
  }
}

function createRunId(now: Date): string {
  runtimeSequence += 1
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')

  return `${timestamp}-${String(runtimeSequence).padStart(3, '0')}`
}
