// Components
export { ChatPanel } from './components/ChatPanel'
export { ChatFab } from './components/ChatFab'
export { ChatHeader } from './components/ChatHeader'
export { SessionList } from './components/SessionList'
export { MessageList } from './components/MessageList'
export { ChatInput } from './components/ChatInput'
export { MarkdownContent } from './components/MarkdownContent'

// Hooks
export { useChatStream } from './hooks/useChatStream'
export { useChatContext } from './hooks/useChatContext'

// Lib / Utils
export { extractNodeInfo, stripMarkers, toolDisplayName } from './lib/chatUtils'
export { handleMindmapToolCall, MINDMAP_ACTION_TOOLS } from './lib/aiToolCalls'

// Store
export {
  useAiStore,
  saveChatHistory,
  loadWorkspaceChat,
} from './model/aiStore'
export type { ChatMessage, ChatSession, AiPipelineStep } from './model/aiStore'
