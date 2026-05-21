import type { WorkflowPromptMessage } from './shared.js'

export function buildExtractStructureMessages(documentText: string): WorkflowPromptMessage[] {
  return [
    {
      role: 'system',
      content: `你是一个文档分析专家。请分析用户提供的文档内容，提取出层次化的知识结构。

只输出 YAML，不要 JSON，不要 Markdown 解释，不要额外前后缀。

输出格式示例：
文档主题:
  - 一级要点:
    - 二级要点
  - 另一个一级要点:
    - 二级子要点

要求：
- 提取核心要点，每层不超过 8 个
- 标题简洁明了（10-30字）
- 保持 2-3 层层级结构
- 有子节点的节点使用"节点内容:"，子节点使用"- 节点内容"
- 根节点顶格写，不要在前面加 -
- 只能使用空格缩进，绝对不要使用 Tab
- 每下降一级，就在上一层前缀基础上只多 2 个前导空格，然后接"- "
- 冒号后面不要再写同一行内容；有子节点就换行后继续缩进
- 节点内容优先保留真实信息，而不是标题化改写`,
    },
    {
      role: 'user',
      content: `请分析以下文档并提取知识结构：\n\n${documentText}`,
    },
  ]
}
