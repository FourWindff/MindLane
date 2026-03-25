import { useCallback, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { useAiStore } from '@/features/chat/model/aiStore'
import { useDocumentStore } from '@/features/document-import/model/documentStore'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'

export function DocumentImportPanel() {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const chatModel = useSettingsStore((s) => s.chatModel)
  const addDocument = useDocumentStore((s) => s.addDocument)
  const documents = useDocumentStore((s) => s.documents)
  const setNodes = useMindmapStore((s) => s.setNodes)
  const setEdges = useMindmapStore((s) => s.setEdges)
  const busy = useAiStore((s) => s.busy)
  const step = useAiStore((s) => s.step)
  const [lastError, setLastError] = useState<string | null>(null)

  const importAndGenerate = useCallback(async () => {
    if (busy) return
    const mindlane = window.mindlane
    if (!mindlane) return

    setLastError(null)
    useAiStore.getState().setBusy(true)
    useAiStore.getState().setStep('reading-doc')

    try {
      const fileResult = await mindlane.file.importDocument()
      if (!fileResult.ok) {
        if (fileResult.error !== '已取消') setLastError(fileResult.error)
        return
      }

      const { docId, filename, content } = fileResult.data

      addDocument({
        id: docId,
        filename,
        importedAt: new Date().toISOString(),
        textPath: `cache:${docId}`,
      })

      if (!apiKey) {
        setLastError('请先在设置中填写 API Key')
        return
      }

      useAiStore.getState().setStep('extracting')

      const result = await mindlane.ai.docToMindmap({
        apiKey,
        model: chatModel,
        documentText: content,
        documentFilename: filename,
      })

      if (!result.ok) {
        setLastError(result.error)
        return
      }

      useAiStore.getState().setStep('generating-map')

      const existingNodes = useMindmapStore.getState().nodes
      const existingEdges = useMindmapStore.getState().edges
      const maxX = existingNodes.reduce((m, n) => Math.max(m, n.position.x), 0)
      const offsetX = maxX + 600

      const newNodes: Node[] = result.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.position.x + offsetX, y: n.position.y },
        data: n.data,
      }))

      const newEdges: Edge[] = result.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        className: 'mindmap-edge mindmap-edge--enter',
      }))

      setNodes([...existingNodes, ...newNodes])
      setEdges([...existingEdges, ...newEdges])
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e))
    } finally {
      useAiStore.getState().reset()
    }
  }, [apiKey, busy, chatModel, addDocument, setEdges, setNodes])

  return (
    <div>
      <div className="panel-section">
        <div className="panel-section__title">文档导入</div>
        <p style={{ fontSize: '0.78rem', color: 'var(--ml-text-muted)', margin: '0 0 0.5rem', lineHeight: 1.4 }}>
          导入 TXT / MD 文档，AI 将自动分析并生成思维导图。
        </p>
        <button
          type="button"
          className="panel-btn panel-btn--primary panel-btn--full"
          onClick={() => void importAndGenerate()}
          disabled={busy}
        >
          {busy ? stepLabel(step) : '选择文档并生成导图'}
        </button>
        {lastError && (
          <p style={{ fontSize: '0.78rem', color: '#b91c1c', marginTop: '0.5rem' }}>
            {lastError}
          </p>
        )}
      </div>
      {documents.length > 0 && (
        <div className="panel-section">
          <div className="panel-section__title">已导入文档</div>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                padding: '0.35rem 0.45rem',
                borderRadius: 6,
                border: '1px solid var(--ml-border)',
                marginBottom: '0.35rem',
                fontSize: '0.78rem',
              }}
            >
              <div style={{ fontWeight: 600 }}>{doc.filename}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--ml-text-muted)' }}>
                {new Date(doc.importedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function stepLabel(step: string): string {
  switch (step) {
    case 'reading-doc': return '读取文档…'
    case 'extracting': return 'AI 分析中…'
    case 'generating-map': return '生成导图…'
    default: return '处理中…'
  }
}
