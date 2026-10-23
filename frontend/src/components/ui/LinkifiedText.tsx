import { Fragment, useMemo } from 'react'

// Only http(s) URLs are linked, so log content can never inject other schemes.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}'"]+$/

type Part = { text: string; href?: string }

export function splitLinks(text: string): Part[] {
  const parts: Part[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    const raw = match[0]
    const url = raw.replace(TRAILING_PUNCTUATION_RE, '')
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: url, href: url })
    last = start + url.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => splitLinks(text), [text])
  return (
    <>
      {parts.map((part, index) => (
        part.href ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className={className ?? 'underline decoration-dotted underline-offset-2 text-sky-400 hover:text-sky-300'}
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      ))}
    </>
  )
}
