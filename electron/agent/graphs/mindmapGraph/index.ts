import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../../providers/index.js'
import { MindmapSubgraphState, type DocumentRef } from '../../state.js'
import { extractTextContent, formatAgentError } from '../../utils.js'
import { serializeMindmapOutline, type MindmapYamlNode } from '../../utils/yamlMindmap.js'
import { validateMindmapYaml } from '../../utils/yamlValidation.js'
import { PdfInputAnalyzer } from './loaders/pdfLoader.js'
import { TextInputAnalyzer, findInputAnalyzer } from './loaders/textLoader.js'
import type { MindmapDocumentLoader, MindmapInputAnalyzer } from './loaders/types.js'
import { buildExtractStructureMessages } from '../../agenthub/prompts/docToMindmap.js'
import { extractRootTree } from './shared/rootTree.js'

// ===== 配置选项 =====

interface MindmapSubgraphOptions {
  provider: LLMProvider
  cacheDocumentText?: (docRef: DocumentRef, text: string) => Promise<DocumentRef | void>
  analyzers?: MindmapInputAnalyzer<unknown, unknown>[]
  loaders?: MindmapDocumentLoader[]
}

const LEAF_BATCH_SIZE = 5
const MERGE_GROUP_SIZE = 8
const SINGLE_PASS_CHAR_LIMIT = 8000
const YAML_GENERATION_ATTEMPTS = 3

type PromptMessage = { role: string; content: string }

function createMindmapRunReset(): Partial<typeof MindmapSubgraphState.State> {
  return {
    response: '',
    error: '',
    mindmapYaml: '',
    mindmapTitle: '',
    documentChunks: [],
    leafCursor: 0,
    pendingLeafRange: null,
    leafResults: [],
    mergeInputs: [],
    partialMergedTrees: [],
    mergeResults: [],
    pendingMergeGroups: [],
    finalTree: null,
  }
}

function createDefaultAnalyzers(): MindmapInputAnalyzer<unknown, unknown>[] {
  return [
    new TextInputAnalyzer(),
    new PdfInputAnalyzer(),
  ]
}

// ===== Prompt builders =====

function buildLeafExtractPrompt(chunksText: string): PromptMessage[] {
  return [
    {
      role: 'system',
      content: `You are a knowledge structure extraction assistant.
Extract a hierarchical mindmap outline from the provided text.
Output only YAML. Do not include JSON, Markdown, or explanations.
Use "node:" format for parent nodes and "- child" for children.
Keep 2-3 levels deep, max 8 children per node.

Example output format:
Root Topic:
  - Section A:
    - Point 1
    - Point 2
  - Section B:
    - Point 3`,
    },
    {
      role: 'user',
      content: `Extract a mindmap outline from the following text:\n\n${chunksText}`,
    },
  ]
}

function buildMergePrompt(treesYaml: string): PromptMessage[] {
  return [
    {
      role: 'system',
      content: `You are a knowledge structure merging assistant.
Merge multiple YAML mindmap trees into one coherent, unified tree.
Output only YAML. Do not include JSON, Markdown, or explanations.
Use "node:" format for parent nodes and "- child" for children.
Keep 2-3 levels deep, max 8 children per node.
Remove duplicates and combine related topics.`,
    },
    {
      role: 'user',
      content: `Merge the following YAML trees into one unified tree:\n\n${treesYaml}`,
    },
  ]
}

async function generateValidMindmapYaml(
  provider: LLMProvider,
  initialMessages: PromptMessage[],
  fallbackTitle: string,
): Promise<MindmapYamlNode> {
  let messages = initialMessages
  let lastReason = 'YAML 校验失败'
  let lastOutput = ''

  for (let attempt = 1; attempt <= YAML_GENERATION_ATTEMPTS; attempt += 1) {
    const response = await provider.reasoningModel.invoke(messages)
    const content = extractTextContent(response.content)
    const validation = validateMindmapYaml(content, {
      mode: 'tree',
      fallbackTitle,
    })

    if (validation.ok) {
      return validation.tree
    }

    lastReason = validation.reason
    lastOutput = content
    messages = buildYamlRepairPrompt(initialMessages, lastOutput, lastReason)
  }

  throw new Error(`YAML 校验失败：${lastReason}`)
}

function buildYamlRepairPrompt(
  originalMessages: PromptMessage[],
  previousOutput: string,
  reason: string,
): PromptMessage[] {
  return [
    ...originalMessages,
    {
      role: 'assistant',
      content: previousOutput,
    },
    {
      role: 'user',
      content: `上一次输出的 YAML 无效，原因：${reason}

请根据原始任务重新生成完整的 outline YAML。
只输出 YAML，不要 JSON，不要 Markdown 解释，不要额外前后缀。
使用缩进表达层级：有子节点的节点写成“节点内容:”，子节点在下一行缩进后用“- 节点内容”。`,
    },
  ]
}

// ===== Node implementations =====

async function loadDocumentNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const source = state.mindmapInputSource
  const reset = createMindmapRunReset()

  if (!source) {
    return {
      ...reset,
      error: '请提供输入来源。',
      response: '请提供输入来源。',
    }
  }

  const analyzer = findInputAnalyzer(options.analyzers ?? options.loaders ?? createDefaultAnalyzers(), source)
  if (!analyzer) {
    return {
      ...reset,
      error: `不支持的输入类型: ${source.type}`,
      response: `不支持的输入类型: ${source.type}`,
    }
  }

  try {
    const loaded = await analyzer.loadDocument(source)

    if (loaded.chunks.length === 0) {
      return {
        ...reset,
        error: '文档未能提取出任何文本内容。',
        response: '文档未能提取出任何文本内容。',
      }
    }

    let documentRef = loaded.documentRef ?? state.documentRef
    if (documentRef && options.cacheDocumentText) {
      const cachedRef = await options.cacheDocumentText(documentRef, loaded.text)
      if (cachedRef) {
        documentRef = cachedRef
      }
    }

    return {
      ...reset,
      documentChunks: loaded.chunks,
      leafCursor: 0,
      pendingLeafRange: { start: 0, end: Math.min(LEAF_BATCH_SIZE, loaded.chunks.length) },
      documentRef,
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    return {
      ...reset,
      error: formatted,
      response: `加载文档失败：${formatted.split('\n')[0]}`,
    }
  }
}

async function dispatchLeafNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const start = state.leafCursor
  const end = Math.min(start + LEAF_BATCH_SIZE, state.documentChunks.length)

  return {
    pendingLeafRange: start < end ? { start, end } : null,
  }
}

async function leafExtractNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const range = state.pendingLeafRange
  if (!range) {
    return {}
  }

  const chunks = state.documentChunks.slice(range.start, range.end)
  const chunksText = chunks.map((c) => c.text).join('\n\n---\n\n')

  try {
    const tree = await generateValidMindmapYaml(
      options.provider,
      buildLeafExtractPrompt(chunksText),
      `Chunk ${range.start + 1}`,
    )

    const firstChunk = chunks[0]
    const lastChunk = chunks[chunks.length - 1]
    const chunkId = firstChunk && lastChunk && firstChunk.id !== lastChunk.id
      ? `${firstChunk.id}..${lastChunk.id}`
      : firstChunk?.id ?? `chunk-${range.start + 1}`

    return {
      leafResults: [...state.leafResults, {
        chunkIndex: range.start,
        chunkId,
        tree,
      }],
      leafCursor: range.end,
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    return {
      error: formatted,
      response: `提取结构失败：${formatted.split('\n')[0]}`,
    }
  }
}

async function collectLeafNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const latestResult = state.leafResults[state.leafResults.length - 1]
  if (!latestResult) {
    return {}
  }

  return {
    mergeInputs: [...state.mergeInputs, latestResult.tree],
  }
}

async function dispatchMergeNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const leafDone = state.leafCursor >= state.documentChunks.length
  const inputs = leafDone
    ? [...state.partialMergedTrees, ...state.mergeInputs]
    : state.mergeInputs.slice(0, MERGE_GROUP_SIZE)
  const groups: Array<{ groupIndex: number; trees: unknown[] }> = []

  for (let i = 0; i < inputs.length; i += MERGE_GROUP_SIZE) {
    groups.push({
      groupIndex: Math.floor(i / MERGE_GROUP_SIZE),
      trees: inputs.slice(i, i + MERGE_GROUP_SIZE),
    })
  }

  return {
    pendingMergeGroups: groups,
    mergeResults: [],
  }
}

async function mergeTreesNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const groups = state.pendingMergeGroups
  if (groups.length === 0) {
    return {}
  }

  // For simplicity, process groups sequentially
  const results: Array<{ groupIndex: number; tree: unknown }> = []

  for (const group of groups) {
    const treesYaml = group.trees
      .map((tree, i) => {
        const rootTree = extractRootTree(tree, `Tree ${i + 1}`)
        return `--- Tree ${i + 1} ---\n${rootTree ? serializeMindmapOutline(rootTree) : String(tree)}`
      })
      .join('\n\n')

    try {
      const tree = await generateValidMindmapYaml(
        options.provider,
        buildMergePrompt(treesYaml),
        `Merged Tree ${group.groupIndex + 1}`,
      )

      results.push({
        groupIndex: group.groupIndex,
        tree,
      })
    } catch (error) {
      const formatted = formatAgentError(error)
      return {
        error: formatted,
        response: `合并结构失败：${formatted.split('\n')[0]}`,
      }
    }
  }

  return {
    mergeResults: results,
  }
}

async function collectMergeNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  if (state.finalTree) {
    return {}
  }

  const results = state.mergeResults
  const trees = results.map((r) => r.tree)
  const leafDone = state.leafCursor >= state.documentChunks.length

  if (!leafDone) {
    return {
      partialMergedTrees: [...state.partialMergedTrees, ...trees],
      mergeInputs: state.mergeInputs.slice(MERGE_GROUP_SIZE),
      pendingMergeGroups: [],
      mergeResults: [],
    }
  }

  // If only one result, it's the final tree
  if (results.length === 1) {
    return {
      finalTree: results[0]!.tree,
      mergeInputs: [],
      partialMergedTrees: [],
      pendingMergeGroups: [],
      mergeResults: [],
    }
  }

  // Multiple results — need another merge round
  return {
    mergeInputs: trees,
    partialMergedTrees: [],
    pendingMergeGroups: [],
    mergeResults: [],
  }
}

async function buildOutputNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  // Preserve existing error
  if (state.error) {
    return {}
  }

  // If mindmapYaml is already set (e.g., from text fast path), nothing to do
  if (state.mindmapYaml) {
    return {}
  }

  const tree = state.finalTree
  const title = state.mindmapInputTitle || '思维导图'

  if (!tree) {
    return {
      error: '未能生成有效的思维导图结构',
      response: '生成思维导图失败：未能生成有效的结构',
    }
  }

  const rootTree = extractRootTree(tree, title)
  if (!rootTree) {
    return {
      error: 'AI 未返回有效的思维导图结构',
      response: '生成思维导图失败：无法解析结构',
    }
  }

  const finalTitle = rootTree.label || title

  if (!rootTree.children || rootTree.children.length === 0) {
    return {
      error: '未提取到任何要点',
      response: '生成思维导图失败：未提取到任何要点',
    }
  }

  return {
    pendingSubgraph: null,
    mindmapYaml: serializeMindmapOutline(rootTree),
    mindmapTitle: finalTitle,
    response: `已生成思维导图「${finalTitle}」。`,
  }
}

// ===== Single-pass extraction =====

async function singleExtractNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const title = state.mindmapInputTitle || '思维导图'
  const text = state.documentChunks.map((chunk) => chunk.text).join('\n\n')
  if (!text.trim()) {
    return {
      error: '文本输入内容为空。',
      response: '文本输入内容为空。',
    }
  }

  try {
    const rootTree = await generateValidMindmapYaml(
      options.provider,
      buildExtractStructureMessages(text),
      title,
    )

    const finalTitle = rootTree.label || title

    if (!rootTree.children || rootTree.children.length === 0) {
      return {
        error: '未提取到任何要点',
        response: '生成思维导图失败：未提取到任何要点',
      }
    }

    return {
      pendingSubgraph: null,
      mindmapYaml: serializeMindmapOutline(rootTree),
      mindmapTitle: finalTitle,
      response: `已生成思维导图「${finalTitle}」。`,
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    return {
      error: formatted,
      response: `生成思维导图失败：${formatted.split('\n')[0]}`,
    }
  }
}

// ===== Edge routing functions =====

function routeAfterLoadDocument(state: typeof MindmapSubgraphState.State): string {
  if (state.error) return 'build_output'
  const totalChars = state.documentChunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  if (totalChars <= SINGLE_PASS_CHAR_LIMIT) return 'single_extract'
  return 'dispatch_leaf'
}

function routeAfterDispatchLeaf(state: typeof MindmapSubgraphState.State): string {
  if (state.pendingLeafRange) return 'leaf_extract'
  return 'dispatch_merge'
}

function routeAfterCollectLeaf(state: typeof MindmapSubgraphState.State): string {
  if (state.mergeInputs.length >= MERGE_GROUP_SIZE) return 'dispatch_merge'
  if (state.leafCursor < state.documentChunks.length) return 'dispatch_leaf'
  if (state.mergeInputs.length > 0 || state.partialMergedTrees.length > 0) return 'dispatch_merge'
  return 'build_output'
}

function routeAfterCollectMerge(state: typeof MindmapSubgraphState.State): string {
  if (state.finalTree) return 'build_output'
  if (state.mergeInputs.length >= MERGE_GROUP_SIZE) return 'dispatch_merge'
  if (state.leafCursor < state.documentChunks.length) return 'dispatch_leaf'
  if (state.mergeInputs.length > 0 || state.partialMergedTrees.length > 0) return 'dispatch_merge'
  return 'build_output'
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Mindmap Subgraph
 *
 * 流程:
 * START -> load_document
 *   - small document -> single_extract -> build_output -> END
 *   - large document -> dispatch_leaf -> leaf_extract -> collect_leaf -> (loop or merge)
 *                     -> dispatch_merge -> merge_trees -> collect_merge -> (loop or output)
 *                     -> build_output -> END
 */
export function buildMindmapSubgraph(options: MindmapSubgraphOptions) {
  const graph = new StateGraph(MindmapSubgraphState)
    .addNode('load_document', (state) => loadDocumentNode(state, options))
    .addNode('dispatch_leaf', (state) => dispatchLeafNode(state))
    .addNode('leaf_extract', (state) => leafExtractNode(state, options))
    .addNode('collect_leaf', (state) => collectLeafNode(state))
    .addNode('dispatch_merge', (state) => dispatchMergeNode(state))
    .addNode('merge_trees', (state) => mergeTreesNode(state, options))
    .addNode('collect_merge', (state) => collectMergeNode(state))
    .addNode('build_output', (state) => buildOutputNode(state))
    .addNode('single_extract', (state) => singleExtractNode(state, options))

  // START -> load_document
  graph.addEdge(START, 'load_document')

  // load_document branches based on document size
  graph.addConditionalEdges('load_document', routeAfterLoadDocument, [
    'single_extract',
    'dispatch_leaf',
    'build_output',
  ])

  // Single-pass path for small documents
  graph.addEdge('single_extract', 'build_output')

  // PDF/document pipeline
  graph.addConditionalEdges('dispatch_leaf', routeAfterDispatchLeaf, [
    'leaf_extract',
    'dispatch_merge',
  ])

  graph.addEdge('leaf_extract', 'collect_leaf')
  graph.addConditionalEdges('collect_leaf', routeAfterCollectLeaf, [
    'dispatch_leaf',
    'dispatch_merge',
    'build_output',
  ])

  graph.addEdge('dispatch_merge', 'merge_trees')
  graph.addEdge('merge_trees', 'collect_merge')
  graph.addConditionalEdges('collect_merge', routeAfterCollectMerge, [
    'dispatch_merge',
    'dispatch_leaf',
    'build_output',
  ])

  // Final output
  graph.addEdge('build_output', END)

  return graph
}
