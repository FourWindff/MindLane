import fs from 'node:fs'
import path from 'node:path'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'

export interface UserProfile {
  preferences: string[]
  thinkingStyle: string
  frequentTopics: string[]
  usagePatterns: string[]
  updatedAt: string
}

const DEFAULT_PROFILE: UserProfile = {
  preferences: [],
  thinkingStyle: '',
  frequentTopics: [],
  usagePatterns: [],
  updatedAt: new Date().toISOString(),
}

let profilePath = ''
let cached: UserProfile | null = null

export function initUserProfile(userDataPath: string): void {
  profilePath = path.join(userDataPath, 'memory', 'user-profile.json')
}

export function loadUserProfile(): UserProfile {
  if (cached) return cached
  try {
    if (fs.existsSync(profilePath)) {
      cached = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as UserProfile
      return cached
    }
  } catch { /* ignore */ }
  cached = { ...DEFAULT_PROFILE }
  return cached
}

function saveProfile(profile: UserProfile): void {
  cached = profile
  if (profilePath) {
    const dir = path.dirname(profilePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8')
  }
}

export async function updateUserProfile(
  model: BaseChatModel,
  conversationSummary: string,
): Promise<UserProfile> {
  const current = loadUserProfile()

  const currentJson = JSON.stringify(current, null, 2)
  const response = await model.invoke([
    new SystemMessage(
      `你是用户画像分析师。根据最近的对话摘要，更新用户画像。
当前画像：
${currentJson}

请输出完整的 JSON 对象，包含以下字段：
- preferences: string[] (用户偏好列表，最多10条)
- thinkingStyle: string (用户的思维方式特点)
- frequentTopics: string[] (常见话题，最多10条)
- usagePatterns: string[] (使用习惯，最多10条)

只输出 JSON，不要额外文字。`,
    ),
    new HumanMessage(conversationSummary),
  ])

  const text = typeof response.content === 'string' ? response.content : String(response.content)
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Partial<UserProfile>
      const updated: UserProfile = {
        preferences: Array.isArray(parsed.preferences) ? parsed.preferences.slice(0, 10) : current.preferences,
        thinkingStyle: typeof parsed.thinkingStyle === 'string' ? parsed.thinkingStyle : current.thinkingStyle,
        frequentTopics: Array.isArray(parsed.frequentTopics) ? parsed.frequentTopics.slice(0, 10) : current.frequentTopics,
        usagePatterns: Array.isArray(parsed.usagePatterns) ? parsed.usagePatterns.slice(0, 10) : current.usagePatterns,
        updatedAt: new Date().toISOString(),
      }
      saveProfile(updated)
      return updated
    }
  } catch { /* keep current */ }

  return current
}

export function getUserProfileText(): string {
  const profile = loadUserProfile()
  const parts: string[] = []
  if (profile.thinkingStyle) parts.push(`思维方式: ${profile.thinkingStyle}`)
  if (profile.preferences.length > 0) parts.push(`偏好: ${profile.preferences.join('、')}`)
  if (profile.frequentTopics.length > 0) parts.push(`常见话题: ${profile.frequentTopics.join('、')}`)
  if (profile.usagePatterns.length > 0) parts.push(`使用习惯: ${profile.usagePatterns.join('、')}`)
  return parts.length > 0 ? parts.join('\n') : ''
}
