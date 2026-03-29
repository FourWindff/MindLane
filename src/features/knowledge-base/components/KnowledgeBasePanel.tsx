import { useCallback, useEffect } from 'react'
import { useKnowledgeBaseStore } from '../model/knowledgeBaseStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'

const PHASE_LABELS: Record<string, string> = {
  loading: '加载文档…',
  splitting: '分割文本…',
  embedding: '生成向量…',
  done: '完成',
  error: '失败',
}

export function KnowledgeBasePanel() {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const documents = useKnowledgeBaseStore((s) => s.documents)
  const indexing = useKnowledgeBaseStore((s) => s.indexing)
  const currentProgress = useKnowledgeBaseStore((s) => s.currentProgress)
  const setDocuments = useKnowledgeBaseStore((s) => s.setDocuments)
  const addDocuments = useKnowledgeBaseStore((s) => s.addDocuments)
  const removeDocument = useKnowledgeBaseStore((s) => s.removeDocument)
  const setIndexing = useKnowledgeBaseStore((s) => s.setIndexing)
  const setProgress = useKnowledgeBaseStore((s) => s.setProgress)

  useEffect(() => {
    const mindlane = window.mindlane
    if (!mindlane) return

    void mindlane.kb.listDocuments().then((docs) => {
      setDocuments(docs)
    })

    const unsubscribe = mindlane.kb.onIndexProgress((progress) => {
      setProgress(progress)
      if (progress.phase === 'done' || progress.phase === 'error') {
        setTimeout(() => setProgress(null), 2000)
      }
    })

    return unsubscribe
  }, [setDocuments, setProgress])

  const handleUpload = useCallback(async () => {
    if (indexing) return
    const mindlane = window.mindlane
    if (!mindlane) return

    setIndexing(true)
    try {
      const result = await mindlane.kb.uploadDocuments()
      if (result.ok) {
        addDocuments(result.data.indexed)
      }
    } catch {
      /* handled via progress events */
    } finally {
      setIndexing(false)
    }
  }, [indexing, addDocuments, setIndexing])

  const handleDelete = useCallback(
    async (docId: string) => {
      const mindlane = window.mindlane
      if (!mindlane) return

      const result = await mindlane.kb.deleteDocument({ docId })
      if (result.ok) {
        removeDocument(docId)
      }
    },
    [removeDocument],
  )

  if (!apiKey) {
    return <div className="panel-empty">请先在「设置」中填写 API Key</div>
  }

  return (
    <div>
      <div className="panel-section">
        <div className="panel-section__title">知识库管理</div>
        <p
          style={{
            fontSize: '0.78rem',
            color: 'var(--ml-text-muted)',
            margin: '0 0 0.5rem',
            lineHeight: 1.4,
          }}
        >
          上传文档到知识库，AI 对话时可自动检索。
          <br />
          支持 MD、PDF、DOCX、MindLane、图片。
        </p>
        <button
          type="button"
          className="panel-btn panel-btn--primary panel-btn--full"
          onClick={() => void handleUpload()}
          disabled={indexing}
        >
          {indexing ? '索引中…' : '上传文档'}
        </button>

        {currentProgress && (
          <div style={{ marginTop: '0.5rem' }}>
            <div
              style={{
                fontSize: '0.74rem',
                color: currentProgress.phase === 'error' ? '#b91c1c' : 'var(--ml-text-muted)',
                marginBottom: '0.25rem',
              }}
            >
              {currentProgress.filename}: {PHASE_LABELS[currentProgress.phase] ?? currentProgress.phase}
              {currentProgress.error && ` - ${currentProgress.error}`}
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: 'var(--ml-border)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(currentProgress.progress * 100)}%`,
                  background: currentProgress.phase === 'error' ? 'var(--ml-danger)' : 'var(--ml-accent)',
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {documents.length > 0 && (
        <div className="panel-section">
          <div className="panel-section__title">已索引文档 ({documents.length})</div>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.35rem 0.45rem',
                borderRadius: 6,
                border: '1px solid var(--ml-border)',
                marginBottom: '0.35rem',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '0.78rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {doc.filename}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--ml-text-muted)' }}>
                  {doc.chunkCount} 个片段 · {new Date(doc.indexedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                className="panel-btn"
                style={{ fontSize: '0.68rem', padding: '0.1rem 0.3rem', marginLeft: '0.4rem', flexShrink: 0 }}
                onClick={() => void handleDelete(doc.id)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
