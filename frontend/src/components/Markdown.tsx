import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

interface MarkdownProps {
  content: string
  className?: string
}

/**
 * Safe Markdown renderer with GitHub-flavored markdown and code syntax
 * highlighting. HTML in the source is NOT rendered (react-markdown escapes it
 * by default), which protects against stored XSS.
 */
function MarkdownImpl({ content, className }: MarkdownProps) {
  return (
    <div className={'md-body ' + (className || '')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
