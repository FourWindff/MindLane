import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import path from 'node:path'
import fs from 'node:fs'

let saver: SqliteSaver | null = null

export async function initCheckpointer(userDataPath: string): Promise<SqliteSaver> {
  const dir = path.join(userDataPath, 'memory')
  await fs.promises.mkdir(dir, { recursive: true })

  const dbPath = path.join(dir, 'checkpoints.db')
  saver = SqliteSaver.fromConnString(dbPath)
  return saver
}

export function getCheckpointer(): SqliteSaver | null {
  return saver
}
