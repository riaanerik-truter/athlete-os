import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, Paperclip } from 'lucide-react'
import { useChat } from '../../hooks/useChat.js'

// ---------------------------------------------------------------------------
// Simple markdown renderer — handles bold, italic, bullet lists, numbered lists
// ---------------------------------------------------------------------------

function renderInline(text) {
  const parts = []
  const re = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g
  let last = 0, m, idx = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[0].startsWith('**')) {
      parts.push(<strong key={idx++}>{m[2]}</strong>)
    } else {
      parts.push(<em key={idx++}>{m[3]}</em>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : text
}

function MarkdownBlock({ text }) {
  const lines  = text.split('\n')
  const nodes  = []
  let ulItems  = [], olItems = []
  let key      = 0

  function flushUl() {
    if (!ulItems.length) return
    nodes.push(
      <ul key={key++} className="list-disc list-inside space-y-0.5 my-1 text-sm">
        {ulItems.map((t, i) => <li key={i}>{renderInline(t)}</li>)}
      </ul>
    )
    ulItems = []
  }
  function flushOl() {
    if (!olItems.length) return
    nodes.push(
      <ol key={key++} className="list-decimal list-inside space-y-0.5 my-1 text-sm">
        {olItems.map((t, i) => <li key={i}>{renderInline(t)}</li>)}
      </ol>
    )
    olItems = []
  }

  for (const line of lines) {
    const ul = line.match(/^[-*] (.+)/)
    const ol = line.match(/^\d+\. (.+)/)
    if (ul) { flushOl(); ulItems.push(ul[1]) }
    else if (ol) { flushUl(); olItems.push(ol[1]) }
    else {
      flushUl(); flushOl()
      if (line.trim()) {
        nodes.push(<p key={key++} className="text-sm leading-relaxed">{renderInline(line)}</p>)
      } else {
        nodes.push(<div key={key++} className="h-1" />)
      }
    }
  }
  flushUl(); flushOl()

  return <div className="space-y-0.5">{nodes}</div>
}

// ---------------------------------------------------------------------------
// Channel badge
// ---------------------------------------------------------------------------

const CHANNEL_LABEL = {
  discord:  { label: 'Discord',  color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  whatsapp: { label: 'WA',       color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'   },
  web:      { label: 'Web',      color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'          },
  api:      { label: 'API',      color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'          },
}

function ChannelBadge({ channel }) {
  const cfg = CHANNEL_LABEL[channel] ?? CHANNEL_LABEL.web
  return (
    <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>
  )
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function Bubble({ msg }) {
  const isCoach  = msg.role === 'coach'
  const ts       = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className={`flex flex-col gap-0.5 ${isCoach ? 'items-start' : 'items-end'}`}>
      <div className={`flex items-center gap-1.5 ${isCoach ? '' : 'flex-row-reverse'}`}>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {isCoach ? 'Coach Ri' : 'You'}
        </span>
        <ChannelBadge channel={msg.channel ?? 'web'} />
        <span className="text-[10px] text-gray-400">{ts}</span>
      </div>
      <div className={`max-w-[90%] rounded-xl px-3 py-2 ${
        isCoach
          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
          : 'bg-accent dark:bg-accent-dark text-white'
      }`}>
        <MarkdownBlock text={msg.content ?? ''} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------

export default function ChatWidget() {
  const { messages, connected, unread, open, setOpen, send, loadingHistory } = useChat()
  const [input, setInput]         = useState('')
  const messagesEndRef             = useRef(null)
  const fileRef                    = useRef(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  function handleSend() {
    const text = input.trim()
    if (!text) return
    send(text)
    setInput('')
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataBase64 = reader.result.split(',')[1]
      send('', { name: file.name, mimeType: file.type, dataBase64 })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div data-tour="chat-widget" className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2">

      {/* Expanded chat panel */}
      {open && (
        <div className="w-[400px] h-[500px] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Coach Ri</span>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400 animate-pulse'}`} title={connected ? 'Connected' : 'Reconnecting…'} />
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Message history */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {loadingHistory && (
              <p className="text-xs text-gray-400 text-center">Loading history…</p>
            )}
            {!loadingHistory && messages.length === 0 && (
              <p className="text-xs text-gray-400 text-center mt-8">
                Start a conversation with Coach Ri
              </p>
            )}
            {messages.map((msg, i) => (
              <Bubble key={msg.id ?? i} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <input type="file" ref={fileRef} className="hidden" onChange={handleFile} />
            <button
              onClick={() => fileRef.current?.click()}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
              title="Attach file"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a message…"
              className="flex-1 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className="p-2 rounded-lg bg-accent dark:bg-accent-dark text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-14 h-14 rounded-full bg-accent dark:bg-accent-dark text-white shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center"
        aria-label="Open chat"
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  )
}
