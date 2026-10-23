import { useEffect, useRef, useState } from 'react'
import { FileText, Film, ImageIcon, Loader2, Paperclip, X } from 'lucide-react'
import { apiService } from '@/services/api'
import type { ForumAttachment } from '@/types/domain'
import { formatFileSize } from './constants'

/** Renders a single attachment, fetching it through the authenticated client. */
function AttachmentItem({ attachment }: { attachment: ForumAttachment }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked = false
    let created: string | null = null
    if (attachment.kind === 'image' || attachment.kind === 'video') {
      apiService
        .fetchForumAttachmentUrl(attachment.url)
        .then((u) => {
          if (revoked) {
            URL.revokeObjectURL(u)
            return
          }
          created = u
          setBlobUrl(u)
        })
        .catch(() => setFailed(true))
    }
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [attachment.url, attachment.kind])

  const download = async () => {
    try {
      const u = await apiService.fetchForumAttachmentUrl(attachment.url)
      const a = document.createElement('a')
      a.href = u
      a.download = attachment.original_name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 4000)
    } catch {
      /* ignore */
    }
  }

  if (attachment.kind === 'image') {
    return (
      <button
        type="button"
        onClick={download}
        title={`${attachment.original_name} — click to download`}
        className="group relative block overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
      >
        {blobUrl ? (
          <img src={blobUrl} alt={attachment.original_name} className="max-h-72 w-auto object-cover" />
        ) : (
          <div className="flex h-40 w-56 items-center justify-center bg-gray-100 dark:bg-gray-800">
            {failed ? <ImageIcon className="text-gray-400" /> : <Loader2 className="animate-spin text-gray-400" />}
          </div>
        )}
      </button>
    )
  }

  if (attachment.kind === 'video') {
    return blobUrl ? (
      <video src={blobUrl} controls className="max-h-80 w-full max-w-lg rounded-lg border border-gray-200 dark:border-gray-700" />
    ) : (
      <div className="flex h-40 w-full max-w-lg items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
        {failed ? <Film className="text-gray-400" /> : <Loader2 className="animate-spin text-gray-400" />}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={download}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:bg-gray-800"
    >
      <FileText size={18} className="shrink-0 text-yellow-500" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-gray-800 dark:text-gray-100">{attachment.original_name}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(attachment.file_size)}</span>
      </span>
    </button>
  )
}

export function AttachmentList({ attachments }: { attachments: ForumAttachment[] }) {
  if (!attachments || attachments.length === 0) return null
  const images = attachments.filter((a) => a.kind === 'image')
  const others = attachments.filter((a) => a.kind !== 'image')
  return (
    <div className="mt-3 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <AttachmentItem key={a.id} attachment={a} />
          ))}
        </div>
      )}
      {others.map((a) => (
        <AttachmentItem key={a.id} attachment={a} />
      ))}
    </div>
  )
}

/** Fetches an image/video attachment through the authenticated client and renders it inline.
 *  Returns null once loaded if the fetch fails, so callers can render fallback UI around it. */
export function MediaPreview({
  attachment,
  className,
}: {
  attachment: ForumAttachment
  className?: string
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked = false
    let created: string | null = null
    setBlobUrl(null)
    setFailed(false)
    apiService
      .fetchForumAttachmentUrl(attachment.url)
      .then((u) => {
        if (revoked) {
          URL.revokeObjectURL(u)
          return
        }
        created = u
        setBlobUrl(u)
      })
      .catch(() => setFailed(true))
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [attachment.url])

  if (failed) return null

  if (!blobUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 ${className || ''}`}>
        <Loader2 size={18} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (attachment.kind === 'image') {
    return <img src={blobUrl} alt={attachment.original_name} className={className} />
  }
  if (attachment.kind === 'video') {
    return <video src={blobUrl} controls preload="metadata" className={className} />
  }
  return null
}

interface AttachmentPickerProps {
  pending: ForumAttachment[]
  onChange: (attachments: ForumAttachment[]) => void
  onError?: (message: string) => void
}

/** Upload button + chips for files being attached to a new post/comment. */
export function AttachmentPicker({ pending, onChange, onError }: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const uploaded: ForumAttachment[] = []
    try {
      for (const file of Array.from(files)) {
        try {
          uploaded.push(await apiService.uploadForumAttachment(file))
        } catch (err) {
          onError?.(apiService.errorMessage(err))
        }
      }
      if (uploaded.length) onChange([...pending, ...uploaded])
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = (id: number) => onChange(pending.filter((a) => a.id !== id))

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.log,.zip,.rtf"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-60 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
        {uploading ? 'Uploading…' : 'Attach files'}
      </button>
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pending.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-2.5 pr-1.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            >
              {a.kind === 'image' ? <ImageIcon size={12} /> : a.kind === 'video' ? <Film size={12} /> : <FileText size={12} />}
              <span className="max-w-[160px] truncate">{a.original_name}</span>
              <button type="button" onClick={() => remove(a.id)} className="rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
