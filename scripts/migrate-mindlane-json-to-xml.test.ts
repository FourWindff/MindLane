/**
 * 一次性迁移 runner：扫描工作区（当前唯一：/home/kris/mindlanetest）内的全部
 * JSON v1.0 .mindlane 文件 → XML v1.0。
 *
 * 转换函数与运行时 XML 序列化共用同一实现（mindmapXml/migrate.ts）。
 * 幂等：已以 `<mindlane` 开头的 XML 文件自动跳过；重复执行不产生重复迁移/重复 asset。
 *
 * 运行方式（vitest 显式执行，不在常规测试套件内）：
 *   MIGRATE_WORKSPACE=/path/to/workspace npm test -- run scripts/migrate-mindlane-json-to-xml.test.ts
 * 缺省 MIGRATE_WORKSPACE 时使用 PRD 唯一工作区 /home/kris/mindlanetest。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { migrateJsonFileToXml } from '../src/shared/lib/mindmapXml/migrate'
import { serializeMindlaneFile } from '../src/shared/lib/mindmapXml/serializer'

const DEFAULT_WORKSPACE = '/home/kris/mindlanetest'

function workspacePath(): string | null {
  return process.env.MIGRATE_WORKSPACE || null
}

function isXmlFile(raw: string): boolean {
  return /^\s*<mindlane\b/.test(raw)
}

async function collectMindlaneFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await collectMindlaneFiles(full)))
    } else if (entry.isFile() && entry.name.endsWith('.mindlane')) {
      results.push(full)
    }
  }
  return results
}

/** 主进程下载：URL → base64（无 data: 前缀）。失败返回 null（迁移期例外：保留 URL 并告警）。 */
async function downloadImage(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    clearTimeout(timer)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/png'
    return { mime: mime || 'image/png', data: buffer.toString('base64') }
  } catch {
    return null
  }
}

describe('migrate-mindlane-json-to-xml (一次性迁移 runner)', () => {
  it('扫描工作区并把 JSON v1.0 文件转换为 XML v1.0', async () => {
    const ws = workspacePath()
    if (!ws) {
      // 缺省工作区可能不存在（CI/其他机器）：跳过而非报错
      if (!fs.existsSync(DEFAULT_WORKSPACE)) return
      process.env.MIGRATE_WORKSPACE = DEFAULT_WORKSPACE
    }
    const dir = workspacePath() ?? DEFAULT_WORKSPACE
    const files = await collectMindlaneFiles(dir)
    expect(Array.isArray(files)).toBe(true)

    let converted = 0
    let skipped = 0
    let failed = 0
    const allWarnings: string[] = []

    for (const filePath of files) {
      let raw: string
      try {
        raw = await fs.promises.readFile(filePath, 'utf-8')
      } catch {
        continue
      }
      if (isXmlFile(raw)) {
        skipped += 1
        continue
      }

      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch (err) {
        failed += 1
        allWarnings.push(
          `[${filePath}] 不是合法 JSON，跳过：${err instanceof Error ? err.message : String(err)}`,
        )
        continue
      }

      try {
        const { xml, warnings } = await migrateJsonFileToXml(json, { downloadImage })
        await fs.promises.writeFile(filePath, xml, 'utf-8')
        converted += 1
        for (const warning of warnings) {
          allWarnings.push(`[${filePath}] ${warning.message}`)
          console.warn(`  ⚠ ${path.basename(filePath)}: ${warning.message}`)
        }
        console.log(`  ✓ ${path.basename(filePath)}`)
      } catch (err) {
        failed += 1
        allWarnings.push(
          `[${filePath}] 转换失败：${err instanceof Error ? err.message : String(err)}`,
        )
        console.error(
          `  ✗ ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    console.log(
      `\n迁移完成：转换 ${converted} 个文件，跳过 ${skipped} 个（已是 XML），失败 ${failed} 个`,
    )
    if (allWarnings.length > 0) {
      console.log(`迁移报告（${allWarnings.length} 条警告/错误）：`)
      for (const w of allWarnings) console.log(w)
    }

    // 断言：无失败；全部产物可被运行时反序列化（roundtrip 验收）
    expect(failed).toBe(0)
    for (const filePath of files) {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      if (!isXmlFile(raw)) continue
      const { deserializeMindlaneFile } = await import('../src/shared/lib/mindmapXml/deserializer')
      const parsed = await deserializeMindlaneFile(raw)
      expect(serializeMindlaneFile(parsed)).toBe(raw)
    }
  }, 600_000)
})
