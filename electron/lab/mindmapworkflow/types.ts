export interface AnthropicLabConfig {
  apiKey: string
  baseUrl: string
  model: string
  pdfPath: string
  outputDir?: string
  chunkCharLimit?: number
  concurrency?: number
  leafChunkGroupSize?: number
  mergeBatchSize?: number
  debug?: boolean
}

export interface NormalizedAnthropicLabConfig {
  apiKey: string
  baseUrl: string
  model: string
  pdfPath: string
  outputDir: string
  chunkCharLimit: number
  concurrency: number
  leafChunkGroupSize: number
  mergeBatchSize: number
  debug: boolean
}

export interface MindmapWorkflowResult {
  yamlPath: string
  logPath: string
  documentTitle: string
  pageCount: number
  leafChunkCount: number
  mergeRounds: number
}

export interface PdfPage {
  text: string
  num: number
}

export interface PdfChunk {
  id: string
  index: number
  startPage: number
  endPage: number
  text: string
}

export interface MindmapYamlNode {
  label: string
  page_range: string
  summary?: string
  children?: MindmapYamlNode[]
}

export interface DocumentMeta {
  pdfPath: string
  title: string
  totalPages: number
  totalChars: number
}

export interface PendingLeafRange {
  start: number
  end: number
}

export interface MergeGroup {
  groupIndex: number
  trees: MindmapYamlNode[]
}

export interface LeafExtractionResult {
  chunkIndex: number
  chunkId: string
  tree: MindmapYamlNode
}

export interface MergeTreeResult {
  groupIndex: number
  tree: MindmapYamlNode
}

export interface WorkflowMetricSnapshot {
  leafChunkCount: number
  leafSuccessCount: number
  leafFailureCount: number
  mergeCallCount: number
}

export interface WorkflowError {
  stage: 'prepare' | 'leaf' | 'merge' | 'finalize'
  message: string
  detail?: string
}

export interface WorkflowLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

export interface ChatModelLike {
  invoke(input: unknown): Promise<{ content?: unknown } | unknown>
}

export interface WorkflowDependencies {
  model?: ChatModelLike
  pdfLoader?: (pdfPath: string) => Promise<PdfPage[]>
  now?: () => Date
}

export interface LoggerLike {
  info(message: string): Promise<WorkflowLogEntry>
  warn(message: string): Promise<WorkflowLogEntry>
  error(message: string): Promise<WorkflowLogEntry>
  debug(message: string): Promise<WorkflowLogEntry>
  flush(): Promise<void>
}

export interface WorkflowRuntime {
  config: NormalizedAnthropicLabConfig
  model: ChatModelLike
  logger: LoggerLike
  pdfLoader: (pdfPath: string) => Promise<PdfPage[]>
  now: () => Date
  artifacts: {
    yamlPath: string
    logPath: string
  }
}
