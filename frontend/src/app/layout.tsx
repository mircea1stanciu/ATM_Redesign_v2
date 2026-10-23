import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ChatProvider } from '@/contexts/ChatContext'
import ChatAwareLayout from '@/components/ChatAwareLayout'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'UnifiedWork - AI-Powered Tech Workspace',
  description: 'A unified workspace for tech teams with specialized AI assistants',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full antialiased`}>
        <ChatProvider>
          <ChatAwareLayout>
            {children}
          </ChatAwareLayout>
        </ChatProvider>
      </body>
    </html>
  )
}
