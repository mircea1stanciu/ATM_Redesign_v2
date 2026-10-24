import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { cn } from './cn'

// Links from Jira/Confluence open in a new tab and never get access to ATM's window.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** HTML from an outside system (Jira, Confluence), sanitised before it is shown. */
export function SafeHtml({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button'] }), [html])
  return <div className={cn('md-body', className)} dangerouslySetInnerHTML={{ __html: clean }} />
}
