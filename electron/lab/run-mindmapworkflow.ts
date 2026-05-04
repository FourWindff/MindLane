import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { runMindmapWorkflow, type AnthropicLabConfig } from './mindmapworkflow.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CONFIG: AnthropicLabConfig = {
  apiKey: '',
  baseUrl: 'https://api.minimaxi.com/anthropic',
  model: 'MiniMax-M2.7',
  pdfPath: path.join(__dirname, 'Hello-Agents-V1.0.2-20260210.pdf'),
  outputDir: path.join(__dirname, 'output'),
  chunkCharLimit: 7000,
  concurrency: 4,
  leafChunkGroupSize: 5,
  mergeBatchSize: 8,
  debug: true,
}

async function main(): Promise<void> {
  if (!CONFIG.apiKey || !CONFIG.baseUrl || !CONFIG.model) {
    throw new Error('请先在 run-mindmapworkflow.ts 顶部填写 apiKey、baseUrl 和 model')
  }

  const result = await runMindmapWorkflow(CONFIG)
  console.log('完成：', result)
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('启动失败：', message)
  process.exitCode = 1
})
