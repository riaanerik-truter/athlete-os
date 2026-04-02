// useChat — WebSocket connection to the messaging service web chat.
//
// Protocol (from webChat.js):
//   Client → server: { text: string, file?: { name, mimeType, dataBase64 } }
//   Server → client: { role: 'coach'|'user', content: string, timestamp: ISO }
//                    { type: 'error', message: string }

import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'

const WS_URL      = 'ws://localhost:3001'
const API_HEADERS = { 'X-API-Key': 'sk-local-kzS5FHuBZ6TNI214' }
const MAX_RECONNECT_DELAY = 30_000
const HISTORY_LIMIT       = 40

export function useChat() {
  const [messages,   setMessages]   = useState([])
  const [connected,  setConnected]  = useState(false)
  const [unread,     setUnread]     = useState(0)
  const [open,       setOpen]       = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const wsRef           = useRef(null)
  const reconnectTimer  = useRef(null)
  const reconnectDelay  = useRef(1000)
  const historyLoaded   = useRef(false)
  // Ref keeps the unread-increment check current without re-creating connect
  const openRef         = useRef(false)

  useEffect(() => { openRef.current = open }, [open])

  // Load conversation history from API on first open
  async function loadHistory() {
    if (historyLoaded.current) return
    setLoadingHistory(true)
    try {
      const res = await axios.get(`/api/v1/conversations?limit=${HISTORY_LIMIT}`, { headers: API_HEADERS })
      const rows = res.data?.data ?? []
      const mapped = rows
        .reverse()
        .map(r => ({
          id:        r.id,
          role:      r.role === 'athlete' ? 'user' : 'coach',
          content:   r.content,
          timestamp: r.created_at,
          channel:   r.channel ?? 'api',
          fromHistory: true,
        }))
      setMessages(mapped)
      historyLoaded.current = true
    } catch { /**/ }
    finally { setLoadingHistory(false) }
  }

  // Connect / reconnect — no dependency on `open` so chat toggle doesn't trigger reconnect
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      reconnectDelay.current = 1000
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'error') return  // ignore protocol errors in message list

        const newMsg = {
          id:        crypto.randomUUID(),
          role:      msg.role === 'coach' ? 'coach' : 'user',
          content:   msg.content,
          timestamp: msg.timestamp ?? new Date().toISOString(),
          channel:   'web',
        }

        setMessages(prev => [...prev, newMsg])

        // Track unread when panel is closed (use ref to avoid stale closure)
        if (msg.role === 'coach') {
          setUnread(n => openRef.current ? 0 : n + 1)
        }
      } catch { /**/ }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      // Exponential back-off reconnect
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY)
        connect()
      }, reconnectDelay.current)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, []) // intentionally no deps — stable function, uses openRef for current open state

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  // Reset unread when panel opens; load history on first open
  useEffect(() => {
    if (open) {
      setUnread(0)
      loadHistory()
    }
  }, [open])

  // Send a text message (+ optional file)
  const send = useCallback((text, file = null) => {
    if (!text?.trim() && !file) return
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return

    const payload = { text }
    if (file) payload.file = file

    wsRef.current.send(JSON.stringify(payload))
  }, [])

  return {
    messages,
    connected,
    unread,
    open,
    setOpen,
    send,
    loadingHistory,
  }
}
