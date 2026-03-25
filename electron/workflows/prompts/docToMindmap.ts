import type { WorkflowPromptMessage } from './shared.js'

export function buildExtractStructureMessages(documentText: string): WorkflowPromptMessage[] {
  return [
    {
      role: 'system',
      content: `你是一个文档分析专家。请分析用户提供的文档内容，提取出层次化的知识结构。

输出严格的 JSON 格式：
{
  "title": "文档主题",
  "points": [
    {
      "title": "一级要点",
      "children": [
        { "title": "二级要点" }
      ]
    }
  ]
}

要求：
- 提取核心要点，每层不超过 8 个
- 标题简洁明了（10-30字）
- 保持 2-3 层层级结构
- 不要输出 JSON 以外的内容`,
    },
    {
      role: 'user',
      content: `请分析以下文档并提取知识结构：\n\n${documentText}`,
    },
  ]
}
