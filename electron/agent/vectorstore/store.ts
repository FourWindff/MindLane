import { HNSWLib } from '@langchain/community/vectorstores/hnswlib'
import { OpenAIEmbeddings } from '@langchain/openai'
import path from 'node:path'
import fs from 'node:fs'

const DASHSCOPE_COMPAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const EMBEDDING_MODEL = 'text-embedding-v3'
/** DashScope embedding API: batch size must be ≤ 10 per request. */
const EMBEDDING_BATCH_SIZE = 10

export function createEmbeddings(apiKey: string, baseUrl?: string): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: EMBEDDING_MODEL,
    apiKey,
    batchSize: EMBEDDING_BATCH_SIZE,
    configuration: { baseURL: baseUrl?.trim() || DASHSCOPE_COMPAT_BASE },
  })
}

export class VectorStoreManager {
  private instance: HNSWLib | null = null
  private storeDir = ''

  async init(userDataPath: string, apiKey: string, baseUrl?: string): Promise<void> {
    this.storeDir = path.join(userDataPath, 'vectorstore')
    await fs.promises.mkdir(this.storeDir, { recursive: true })

    const embeddings = createEmbeddings(apiKey, baseUrl)
    const indexPath = path.join(this.storeDir, 'hnswlib.index')

    if (fs.existsSync(indexPath)) {
      this.instance = await HNSWLib.load(this.storeDir, embeddings)
    } else {
      this.instance = new HNSWLib(embeddings, { space: 'cosine' })
    }
  }

  get(): HNSWLib | null {
    return this.instance
  }

  async save(): Promise<void> {
    if (this.instance && this.storeDir) {
      await this.instance.save(this.storeDir)
    }
  }

  async reset(apiKey: string, baseUrl?: string): Promise<HNSWLib> {
    const embeddings = createEmbeddings(apiKey, baseUrl)
    this.instance = new HNSWLib(embeddings, { space: 'cosine' })
    if (this.storeDir) {
      await this.instance.save(this.storeDir)
    }
    return this.instance
  }
}
