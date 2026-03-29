import { HNSWLib } from '@langchain/community/vectorstores/hnswlib'
import { OpenAIEmbeddings } from '@langchain/openai'
import path from 'node:path'
import fs from 'node:fs'

const DASHSCOPE_COMPAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const EMBEDDING_MODEL = 'text-embedding-v3'

let instance: HNSWLib | null = null
let storeDir = ''

export function createEmbeddings(apiKey: string, baseUrl?: string): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: EMBEDDING_MODEL,
    apiKey,
    configuration: { baseURL: baseUrl?.trim() || DASHSCOPE_COMPAT_BASE },
  })
}

export async function initVectorStore(
  userDataPath: string,
  apiKey: string,
  baseUrl?: string,
): Promise<HNSWLib> {
  storeDir = path.join(userDataPath, 'vectorstore')
  await fs.promises.mkdir(storeDir, { recursive: true })

  const embeddings = createEmbeddings(apiKey, baseUrl)
  const indexPath = path.join(storeDir, 'hnswlib.index')

  if (fs.existsSync(indexPath)) {
    instance = await HNSWLib.load(storeDir, embeddings)
  } else {
    instance = new HNSWLib(embeddings, { space: 'cosine' })
  }

  return instance
}

export function getVectorStore(): HNSWLib | null {
  return instance
}

export async function saveVectorStore(): Promise<void> {
  if (instance && storeDir) {
    await instance.save(storeDir)
  }
}

export async function resetVectorStore(
  apiKey: string,
  baseUrl?: string,
): Promise<HNSWLib> {
  const embeddings = createEmbeddings(apiKey, baseUrl)
  instance = new HNSWLib(embeddings, { space: 'cosine' })
  if (storeDir) {
    await instance.save(storeDir)
  }
  return instance
}
