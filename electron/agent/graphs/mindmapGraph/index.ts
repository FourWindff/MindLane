import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../../providers/index.js'
import { MindmapSubgraphState } from '../../state.js'
import { extractTextContent, formatAgentError } from '../../utils.js'
import { extractYaml, sanitizeTreeCandidate, serializeMindmapOutline } from '../../utils/yamlMindmap.js'
import { PdfDocumentLoader, chunkPages } from './loaders/pdfLoader.js'
import { buildExtractStructureMessages } from '../../agenthub/prompts/docToMindmap.js'
import { extractRootTree } from './shared/rootTree.js'

// ===== 配置选项 =====

export interface MindmapSubgraphOptions {
  provider: LLMProvider
}

const LEAF_BATCH_SIZE = 5
const MERGE_GROUP_SIZE = 8
const CHUNK_CHAR_LIMIT = 4000

// ===== Prompt builders =====

function buildLeafExtractPrompt(chunksText: string): Array<{ role: string; content: string }> {
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

function buildMergePrompt(treesYaml: string): Array<{ role: string; content: string }> {
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

// ===== Node implementations =====

async function loadDocumentNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const source = state.mindmapInputSource

  if (!source) {
    return {
      error: '请提供输入来源。',
      response: '请提供输入来源。',
    }
  }

  // Text input: create a single chunk, skip PDF loading
  if (source.type === 'text') {
    const content = source.content ?? ''
    if (!content.trim()) {
      return {
        error: '文本输入内容为空。',
        response: '文本输入内容为空。',
      }
    }
    const chunks = [{
      id: 'chunk-1',
      index: 0,
      startPage: 0,
      endPage: 0,
      text: content,
    }]
    return {
      documentChunks: chunks,
      leafCursor: 0,
      pendingLeafRange: { start: 0, end: 1 },
    }
  }

  // PDF input: use PdfDocumentLoader
  if (source.type === 'pdf') {
    try {
      const loader = new PdfDocumentLoader()
      const pages = await loader.load(source)
      const chunks = chunkPages(pages, CHUNK_CHAR_LIMIT)

      if (chunks.length === 0) {
        return {
          error: 'PDF 文档未能提取出任何文本内容。',
          response: 'PDF 文档未能提取出任何文本内容。',
        }
      }

      return {
        documentChunks: chunks,
        leafCursor: 0,
        pendingLeafRange: { start: 0, end: Math.min(LEAF_BATCH_SIZE, chunks.length) },
      }
    } catch (error) {
      const formatted = formatAgentError(error)
      return {
        error: formatted,
        response: `加载 PDF 失败：${formatted.split('\n')[0]}`,
      }
    }
  }

  // URL or other types not yet supported
  return {
    error: `不支持的输入类型: ${source.type}`,
    response: `不支持的输入类型: ${source.type}`,
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
    const response = await options.provider.reasoningModel.invoke(
      buildLeafExtractPrompt(chunksText),
    )
    const content = extractTextContent(response.content)
    const parsedYaml = extractYaml(content)
    const treeCandidate = sanitizeTreeCandidate(parsedYaml)

    const newResults = chunks.map((chunk, idx) => ({
      chunkIndex: range.start + idx,
      chunkId: chunk.id,
      tree: treeCandidate,
    }))

    return {
      leafResults: newResults,
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
  // If there are more chunks to process, continue to dispatch_leaf
  if (state.leafCursor < state.documentChunks.length) {
    return {}
  }

  // All chunks processed — prepare merge inputs from leaf results
  const inputs = state.leafResults.map((r) => r.tree)
  return {
    mergeInputs: inputs,
  }
}

async function dispatchMergeNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const inputs = state.mergeInputs
  const groups: Array<{ groupIndex: number; trees: unknown[] }> = []

  for (let i = 0; i < inputs.length; i += MERGE_GROUP_SIZE) {
    groups.push({
      groupIndex: Math.floor(i / MERGE_GROUP_SIZE),
      trees: inputs.slice(i, i + MERGE_GROUP_SIZE),
    })
  }

  return {
    pendingMergeGroups: groups,
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
      const response = await options.provider.reasoningModel.invoke(
        buildMergePrompt(treesYaml),
      )
      const content = extractTextContent(response.content)
      const parsedYaml = extractYaml(content)
      const treeCandidate = sanitizeTreeCandidate(parsedYaml)

      results.push({
        groupIndex: group.groupIndex,
        tree: treeCandidate,
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
  const results = state.mergeResults

  // If only one result, it's the final tree
  if (results.length === 1) {
    return {
      finalTree: results[0]!.tree,
      mergeInputs: [],
      pendingMergeGroups: [],
    }
  }

  // Multiple results — need another merge round
  const newInputs = results.map((r) => r.tree)
  return {
    mergeInputs: newInputs,
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
    mindmapYaml: serializeMindmapOutline(rootTree),
    mindmapTitle: finalTitle,
    response: `已生成思维导图「${finalTitle}」。`,
  }
}

// ===== Text input fast path =====

async function textInputExtractNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const source = state.mindmapInputSource
  const title = state.mindmapInputTitle || '思维导图'

  if (!source || source.type !== 'text') {
    return {}
  }

  const content = source.content ?? ''
  if (!content.trim()) {
    return {
      error: '文本输入内容为空。',
      response: '文本输入内容为空。',
    }
  }

  try {
    const text = content.slice(0, 8000)
    const extractResponse = await options.provider.reasoningModel.invoke(
      buildExtractStructureMessages(text),
    )
    const extractContent = extractTextContent(extractResponse.content)

    const parsedYaml = extractYaml(extractContent)
    const treeCandidate = sanitizeTreeCandidate(parsedYaml)
    const rootTree = extractRootTree(treeCandidate, title)

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
  if (state.mindmapInputSource?.type === 'text') return 'text_extract'
  return 'dispatch_leaf'
}

function routeAfterDispatchLeaf(state: typeof MindmapSubgraphState.State): string {
  if (state.pendingLeafRange) return 'leaf_extract'
  return 'dispatch_merge'
}

function routeAfterCollectLeaf(state: typeof MindmapSubgraphState.State): string {
  if (state.leafCursor < state.documentChunks.length) return 'dispatch_leaf'
  if (state.mergeInputs.length > 0) return 'dispatch_merge'
  return 'build_output'
}

function routeAfterCollectMerge(state: typeof MindmapSubgraphState.State): string {
  if (state.finalTree) return 'build_output'
  if (state.mergeInputs.length > 1) return 'dispatch_merge'
  return 'build_output'
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Mindmap Subgraph
 *
 * 流程:
 * START -> load_document
 *   - text input -> text_extract -> build_output -> END
 *   - pdf input  -> dispatch_leaf -> leaf_extract -> collect_leaf -> (loop or merge)
 *                  -> dispatch_merge -> merge_trees -> collect_merge -> (loop or output)
 *                  -> build_output -> END
 */
export function buildMindmapSubgraph(options: MindmapSubgraphOptions) {
  const graph = new StateGraph(MindmapSubgraphState)
    .addNode('load_document', (state) => loadDocumentNode(state))
    .addNode('dispatch_leaf', (state) => dispatchLeafNode(state))
    .addNode('leaf_extract', (state) => leafExtractNode(state, options))
    .addNode('collect_leaf', (state) => collectLeafNode(state))
    .addNode('dispatch_merge', (state) => dispatchMergeNode(state))
    .addNode('merge_trees', (state) => mergeTreesNode(state, options))
    .addNode('collect_merge', (state) => collectMergeNode(state))
    .addNode('build_output', (state) => buildOutputNode(state))
    .addNode('text_extract', (state) => textInputExtractNode(state, options))

  // START -> load_document
  graph.addEdge(START, 'load_document')

  // load_document branches based on input type
  graph.addConditionalEdges('load_document', routeAfterLoadDocument, [
    'text_extract',
    'dispatch_leaf',
    'build_output',
  ])

  // text fast path
  graph.addEdge('text_extract', 'build_output')

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
    'build_output',
  ])

  // Final output
  graph.addEdge('build_output', END)

  return graph
}
