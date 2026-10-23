import { useState } from 'react'
import { Eye, Loader2, Pencil, Send, Tag, X } from 'lucide-react'
import { apiService } from '@/services/api'
import type { ForumAttachment, ForumPost } from '@/types/domain'
import { Markdown } from './Markdown'
import { AttachmentPicker } from './attachments'

interface PostComposerProps {
  communityId: string
  existing?: ForumPost
  initialCategory?: string
  initialTeam?: string
  onCancel: () => void
  onSaved: (post: ForumPost) => void
}

export function PostComposer({ communityId, existing, initialCategory, initialTeam, onCancel, onSaved }: PostComposerProps) {
  const [title, setTitle] = useState(existing?.title || '')
  const [body, setBody] = useState(existing?.body || '')
  const lockedTags = [initialCategory, initialTeam].filter((t): t is string => Boolean(t))
  const [tags, setTags] = useState<string[]>(existing?.tags || lockedTags)
  const [tagInput, setTagInput] = useState('')
  const [attachments, setAttachments] = useState<ForumAttachment[]>([])
  const [preview, setPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = Boolean(existing)

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t) && tags.length < 10) setTags([...tags, t])
    setTagInput('')
  }

  const submit = async () => {
    if (!title.trim()) {
      setError('A title is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const post = isEdit
        ? await apiService.updateForumPost(existing!.id, { title, body, tags })
        : await apiService.createForumPost({
            community_id: communityId,
            title,
            body,
            tags,
            attachment_ids: attachments.map((a) => a.id),
          })
      onSaved(post)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {isEdit ? 'Edit post' : 'Start a discussion'}
          </h3>
          {initialCategory && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-500/30 dark:text-yellow-200">
              📁 {initialCategory.replace(/-/g, ' ')}
            </span>
          )}
          {initialTeam && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/30 dark:text-amber-200">
              👥 {initialTeam.replace(/-/g, ' ')}
            </span>
          )}
        </div>
        <button onClick={onCancel} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700">
          <X size={18} />
        </button>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="An interesting, specific title"
        maxLength={300}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Body (Markdown supported)</span>
          <button
            onClick={() => setPreview((p) => !p)}
            className="inline-flex items-center gap-1 text-xs font-medium text-yellow-600 hover:underline dark:text-yellow-400"
          >
            {preview ? <Pencil size={12} /> : <Eye size={12} />}
            {preview ? 'Write' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="min-h-[8rem] rounded-lg border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            {body.trim() ? <Markdown content={body} /> : <p className="text-sm text-gray-400">Nothing to preview.</p>}
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share details, code snippets (```ts ... ```), links…"
            rows={8}
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-800 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        )}
      </div>

      {/* Tags */}
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((t) => (
            <span key={t} className={`inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1.5 text-xs font-medium ${
              lockedTags.includes(t)
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/30 dark:text-yellow-200'
                : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300'
            }`}>
              #{t}
              {!lockedTags.includes(t) && (
                <button onClick={() => setTags(tags.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-yellow-100 dark:hover:bg-yellow-500/20">
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          <div className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 dark:border-gray-600">
            <Tag size={12} className="text-gray-400" />
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag()
                }
              }}
              onBlur={addTag}
              placeholder="add tag"
              className="w-20 bg-transparent text-xs text-gray-700 focus:outline-none dark:text-gray-200"
            />
          </div>
        </div>
      </div>

      {!isEdit && (
        <div className="mt-3">
          <AttachmentPicker pending={attachments} onChange={setAttachments} onError={setError} />
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || !title.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-yellow-600 disabled:opacity-60"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {isEdit ? 'Save changes' : 'Publish'}
        </button>
      </div>
    </div>
  )
}
