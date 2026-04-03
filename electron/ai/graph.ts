import { END, START, StateGraph } from '@langchain/langgraph'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { LLMProvider } from './providers/index.js'
import type { AiService } from './service.js'
import { AgentState } from './state.js'
import { createSupervisorNode, createToolsNode, routeSupervisor } from './agents/supervisor.js'
import { createAnalyzeNode } from './agents/analyze.js'
import { createImageGenNode } from './agents/imageGen.js'
import { createVisionNode } from './agents/vision.js'
import { createMindmapGenNode } from './agents/mindmapGen.js'
import { createSearchTools } from './agents/tools/index.js'
import type { MindmapContextData } from './agents/tools/mindmapContext.js'

export function buildGraph(params: {
  model: BaseChatModel
  reasoningModel: BaseChatModel
  runtime: LLMProvider
  aiService: AiService
  apiKey: string
  modelName: string
  context?: MindmapContextData
}) {
  const { model, reasoningModel, runtime, aiService, apiKey, modelName } = params

  const { listKnowledgeBaseTool, searchDocumentsTool } = createSearchTools(
    aiService.vectorStore,
    aiService.indexer,
  )
  const tools = [
    listKnowledgeBaseTool,
    searchDocumentsTool,
  ]

  const profileText = aiService.userProfile.getText()

  const supervisorNode = createSupervisorNode({ model, tools, profileText })
  const toolsNode = createToolsNode(tools)
  const analyzeNode = createAnalyzeNode(reasoningModel)
  const imageGenNode = createImageGenNode({ model: reasoningModel, runtime })
  const visionNode = createVisionNode({ model: reasoningModel, runtime })
  const mindmapGenNode = createMindmapGenNode({ apiKey, modelName })

  const graph = new StateGraph(AgentState)
    .addNode('supervisor', supervisorNode)
    .addNode('tools', toolsNode)
    .addNode('analyze', analyzeNode)
    .addNode('imageGen', imageGenNode)
    .addNode('vision', visionNode)
    .addNode('mindmapGen', mindmapGenNode)
    .addEdge(START, 'supervisor')
    .addConditionalEdges('supervisor', routeSupervisor)
    .addEdge('tools', 'supervisor')
    .addEdge('analyze', 'imageGen')
    .addEdge('imageGen', 'vision')
    .addEdge('vision', END)
    .addEdge('mindmapGen', END)

  return graph
}

export function buildPalaceGraph(params: {
  reasoningModel: BaseChatModel
  runtime: LLMProvider
}) {
  const { reasoningModel, runtime } = params

  const analyzeNode = createAnalyzeNode(reasoningModel)
  const imageGenNode = createImageGenNode({ model: reasoningModel, runtime })
  const visionNode = createVisionNode({ model: reasoningModel, runtime })

  const graph = new StateGraph(AgentState)
    .addNode('analyze', analyzeNode)
    .addNode('imageGen', imageGenNode)
    .addNode('vision', visionNode)
    .addEdge(START, 'analyze')
    .addEdge('analyze', 'imageGen')
    .addEdge('imageGen', 'vision')
    .addEdge('vision', END)

  return graph
}
