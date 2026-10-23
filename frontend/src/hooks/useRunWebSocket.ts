import { useEffect, useMemo, useState } from 'react'
import type { WsRunMessage } from '@/types/domain'

interface UseRunWebSocketOptions {
  runId: string | null
  enabled: boolean
}

export function useRunWebSocket({ runId, enabled }: UseRunWebSocketOptions) {
  const [messages, setMessages] = useState<WsRunMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    setMessages([])
    setConnectionError(null)
    if (!enabled || !runId) {
      setConnected(false)
      return
    }

    // Same origin as the page: the dev proxy and nginx forward /api/ws/* to the backend.
    const base = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    // Browsers cannot send an Authorization header on a WebSocket; the token travels as a subprotocol instead.
    const token = localStorage.getItem('tm_access_token') || ''
    const socket = new WebSocket(`${base}/api/ws/runs/${runId}`, ['atm-token', token])

    socket.onopen = () => {
      setConnected(true)
      setConnectionError(null)
    }

    socket.onclose = () => {
      setConnected(false)
    }

    socket.onerror = () => {
      setConnectionError('WebSocket connection failed.')
      setConnected(false)
    }

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WsRunMessage
        setMessages((prev) => {
          const next = [
            ...prev,
            {
              ...payload,
              timestamp: new Date().toISOString(),
            },
          ]
          return next.slice(-300)
        })
      } catch {
        const rawData = typeof event.data === 'string' ? event.data.trim().toLowerCase() : ''
        // Ignore websocket heartbeat frames.
        if (rawData === 'pong' || rawData === 'ping') {
          return
        }

        setMessages((prev) => [
          ...prev,
          {
            type: 'raw',
            data: event.data,
            timestamp: new Date().toISOString(),
          },
        ].slice(-300))
      }
    }

    const ping = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send('ping')
      }
    }, 15000)

    return () => {
      window.clearInterval(ping)
      socket.close()
      setConnected(false)
    }
  }, [enabled, runId])

  const cliText = useMemo(() => {
    return messages
      .map((message) => {
        const type = (message.type || '').toLowerCase()

        // Keep stdout/stderr output as close as possible to terminal output.
        if (type === 'stdout' || type === 'stderr' || type === 'raw') {
          if (typeof message.data === 'string') return message.data
          if (message.data == null) return ''
          return JSON.stringify(message.data)
        }

        if (type === 'status') {
          return `$ status: ${message.status || ''}`.trimEnd()
        }

        if (typeof message.data === 'string') return message.data
        if (message.data == null) return message.status || ''
        return JSON.stringify(message.data)
      })
      .filter(Boolean)
      .join('\n')
  }, [messages])

  const structuredText = useMemo(() => {
    return messages
      .map((message) => {
        const time = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : ''
        const data = message.data || message.status || ''
        return `[${time}] ${message.type.toUpperCase()}: ${data}`
      })
      .join('\n')
  }, [messages])

  return {
    messages,
    groupedText: cliText,
    cliText,
    structuredText,
    connected,
    connectionError,
    clearMessages: () => setMessages([]),
  }
}
