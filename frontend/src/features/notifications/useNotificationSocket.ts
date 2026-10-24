import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/ui'
import type { AppNotification } from './api'
import { notificationKeys } from './api'

const RECONNECT_MS = 5000

/** Listens for the user's new notifications: refreshes the bell and shows a toast. Reconnects after a drop. */
export function useNotificationSocket(enabled: boolean) {
  const queryClient = useQueryClient()
  const toast = useToast()

  useEffect(() => {
    if (!enabled) return
    let socket: WebSocket | null = null
    let ping = 0
    let retry = 0
    let stopped = false

    const connect = () => {
      // Same origin as the page; the token travels as a subprotocol (browsers cannot set headers on a WebSocket).
      const base = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
      const token = localStorage.getItem('tm_access_token') || ''
      socket = new WebSocket(`${base}/api/ws/notifications`, ['atm-token', token])
      socket.onmessage = event => {
        let payload: { type?: string; notification?: AppNotification }
        try {
          payload = JSON.parse(event.data)
        } catch {
          return // pong
        }
        if (payload.type === 'hello') {
          // Connected (or reconnected): catch up on anything sent while the socket was not open.
          void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
          return
        }
        if (payload.type !== 'notification' || !payload.notification) return
        void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
        if (payload.notification.kind === 'deployment' || payload.notification.kind === 'deployment_check') {
          void queryClient.invalidateQueries({ queryKey: ['deployments'] })
        }
        toast({ title: payload.notification.title, description: payload.notification.body ?? undefined, tone: 'info' })
      }
      socket.onclose = () => {
        window.clearInterval(ping)
        if (!stopped) retry = window.setTimeout(connect, RECONNECT_MS)
      }
      ping = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send('ping')
      }, 25_000)
    }

    connect()
    return () => {
      stopped = true
      window.clearInterval(ping)
      window.clearTimeout(retry)
      socket?.close()
    }
  }, [enabled, queryClient, toast])
}
