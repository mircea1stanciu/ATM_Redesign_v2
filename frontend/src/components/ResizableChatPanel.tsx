'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import MessengerView from './MessengerView'
import { useChat } from '../contexts/ChatContext'

interface ResizableChatPanelProps {
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
}

export default function ResizableChatPanel({
  defaultWidth = 900,
  minWidth = 600,
  maxWidth = 1200
}: ResizableChatPanelProps) {
  const { closeChat } = useChat()
  const [width, setWidth] = useState(defaultWidth)
  const [height, setHeight] = useState(800)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Load saved dimensions from localStorage
  useEffect(() => {
    const savedWidth = localStorage.getItem('chatOverlayWidth')
    const savedHeight = localStorage.getItem('chatOverlayHeight')
    if (savedWidth) {
      const parsedWidth = parseInt(savedWidth, 10)
      if (parsedWidth >= minWidth && parsedWidth <= maxWidth) {
        setWidth(parsedWidth)
      }
    }
    if (savedHeight) {
      const parsedHeight = parseInt(savedHeight, 10)
      if (parsedHeight >= 600 && parsedHeight <= 1000) {
        setHeight(parsedHeight)
      }
    }
  }, [minWidth, maxWidth])

  return (
    <>
      {/* Backdrop Blur */}
      <div 
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity duration-300"
        onClick={closeChat}
      />

      {/* Chat Overlay */}
      <div
        ref={panelRef}
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
        style={{ 
          width: `${width}px`, 
          height: `${height}px`,
          maxWidth: '90vw',
          maxHeight: '90vh'
        }}
      >
        {/* Header with Close Button */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">💬 Team Messenger</h2>
          <button
            onClick={closeChat}
            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Close"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Chat Panel Content - MessengerView */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <MessengerView />
        </div>
      </div>
    </>
  )
}
