import { useCallback, useRef, useState } from 'react'
import { useSettingsStore } from '@/features/settings/model/settingsStore'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export function ChatPanel() {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const chatModel = useSettingsStore((s) => s.chatModel)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    if (!apiKey) return

    const userMsg: Message = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setBusy(true)
    scrollToBottom()

    try {
      const api = window.mindlane?.ai
      if (!api) return

      const result = await api.chat({
        apiKey,
        model: chatModel,
        messages: next,
      })

      if (result.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.content },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `错误：${result.error}` },
        ])
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `异常：${e instanceof Error ? e.message : String(e)}` },
      ])
    } finally {
      setBusy(false)
      scrollToBottom()
    }
  }, [apiKey, busy, chatModel, input, messages, scrollToBottom])

  if (!apiKey) {
    return (
      <div className="panel-empty">
        请先在「设置」中填写 API Key
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}
      >
        {messages.length === 0 && (
          <div className="panel-empty">输入消息开始对话</div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '0.5rem 0.7rem',
              borderRadius: 10,
              fontSize: '0.82rem',
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(msg.role === 'user'
                ? { background: '#1a1a1a', color: '#fff' }
                : { background: 'var(--ml-fill-soft)', border: '1px solid var(--ml-border)' }),
            }}
          >
            {msg.content}
          </div>
        ))}
        {busy && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '0.5rem 0.7rem',
              borderRadius: 10,
              fontSize: '0.82rem',
              background: 'var(--ml-fill-soft)',
              border: '1px solid var(--ml-border)',
              color: 'var(--ml-text-muted)',
            }}
          >
            思考中…
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="输入消息… (Enter 发送)"
          disabled={busy}
          style={{
            flex: 1,
            minHeight: '2.8rem',
            maxHeight: '6rem',
            resize: 'vertical',
            borderRadius: 8,
            border: '1px solid var(--ml-border)',
            padding: '0.4rem 0.55rem',
            font: 'inherit',
            fontSize: '0.82rem',
            outline: 'none',
          }}
        />
        <button
          type="button"
          className="panel-btn panel-btn--primary"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          style={{ alignSelf: 'flex-end' }}
        >
          发送
        </button>
      </div>
    </div>
  )
}
