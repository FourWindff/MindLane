import { FileText, Link, FileType, Paperclip } from 'lucide-react'
import type { DocumentRef } from '@/shared/lib/fileFormat'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { showToast } from '@/shared/model/toastStore'

function DocumentRefIcon({ type }: { type: DocumentRef['type'] }) {
  switch (type) {
    case 'pdf':
    case 'docx':
    case 'pptx':
    case 'xlsx':
    case 'markdown':
      return <FileText size={16} strokeWidth={1.5} />
    case 'url':
      return <Link size={16} strokeWidth={1.5} />
    case 'text':
      return <FileType size={16} strokeWidth={1.5} />
  }
}

function getDocumentRefLabel(doc: DocumentRef): string {
  return doc.type === 'url' || doc.type === 'text' ? doc.source : doc.filename
}

export function DocumentRefsPanel({ onClose }: { onClose?: () => void }) {
  const documentRefs = useActiveMindmapStore((s) => s.documentRefs)

  const handleOpen = async (doc: DocumentRef) => {
    const result = await window.mindlane?.shell.openDocumentRef(doc)
    if (result && !result.ok) {
      showToast(result.error)
    }
  }

  return (
    <div className="document-refs-panel" role="dialog" aria-label="关联文件">
      <div className="document-refs-panel__header">
        <span className="document-refs-panel__title">
          <Paperclip size={14} strokeWidth={1.5} />
          关联文件
        </span>
        {onClose && (
          <button
            className="document-refs-panel__close"
            onClick={onClose}
            aria-label="关闭关联文件面板"
          >
            ✕
          </button>
        )}
      </div>

      <ul className="document-refs-panel__list" role="list">
        {documentRefs.map((doc) => (
          <li key={doc.id} className="document-refs-panel__item">
            <button className="document-refs-panel__row" onClick={() => void handleOpen(doc)}>
              <span className="document-refs-panel__icon">
                <DocumentRefIcon type={doc.type} />
              </span>
              <span className="document-refs-panel__label">{getDocumentRefLabel(doc)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
