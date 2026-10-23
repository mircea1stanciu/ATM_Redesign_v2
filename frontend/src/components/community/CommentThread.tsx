import { useEffect, useMemo, useState } from 'react'
import { CornerDownRight, Heart, Loader2, Pencil, Reply, Send, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { apiService } from '@/services/api'
import type { ForumComment, ForumAttachment } from '@/types/domain'
import { Markdown } from './Markdown'
import { AttachmentList, AttachmentPicker } from './attachments'

interface CommentThreadProps {
  postId: number
  isLocked: boolean
  onCountChange?: (count: number) => void
}

function initials(name?: string | null, fallback?: string | null): string {
  const n = name || fallback || '?'
  return n
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso + (iso.endsWith('Z') ? '' : 'Z')), { addSuffix: true })
  } catch {
    return ''
  }
}

interface CommentTreeNode extends ForumComment {
  children: CommentTreeNode[]
}

export function CommentThread({ postId, isLocked, onCountChange }: CommentThreadProps) {
  const [comments, setComments] = useState<ForumComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)

  const load = async () => {
    try {
      const data = await apiService.listForumComments(postId)
      setComments(data)
      onCountChange?.(data.length)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  const tree = useMemo<CommentTreeNode[]>(() => {
    const map = new Map<number, CommentTreeNode>()
    const roots: CommentTreeNode[] = []
    comments.forEach((c) => map.set(c.id, { ...c, children: [] }))
    map.forEach((node) => {
      if (node.parent_comment_id && map.has(node.parent_comment_id)) {
        map.get(node.parent_comment_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    })
    return roots
  }, [comments])

  const handleLike = async (commentId: number) => {
    try {
      const res = await apiService.likeForumComment(commentId)
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, liked_by_me: res.liked, like_count: res.like_count } : c)),
      )
    } catch {
      /* ignore */
    }
  }

  const handleDelete = async (commentId: number) => {
    if (!window.confirm('Delete this comment?')) return
    try {
      await apiService.deleteForumComment(commentId)
      await load()
    } catch (err) {
      setError(apiService.errorMessage(err))
    }
  }

  const renderNode = (node: CommentTreeNode, depth: number) => (
    <div key={node.id} className={depth > 0 ? 'ml-5 mt-3 border-l-2 border-gray-100 pl-4 dark:border-gray-700/60' : 'mt-4'}>
      <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700/70 dark:bg-gray-800/70">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-yellow-500 to-amber-500 text-[10px] font-semibold text-white">
            {initials(node.author?.full_name, node.author?.username)}
          </div>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {node.author?.full_name || node.author?.username || 'Unknown'}
          </span>
          <span className="text-xs text-gray-400">· {timeAgo(node.created_at)}</span>
          {node.updated_at !== node.created_at && <span className="text-xs italic text-gray-400">(edited)</span>}
        </div>

        {editingId === node.id ? (
          <InlineEditor
            initial={node.body}
            onCancel={() => setEditingId(null)}
            onSave={async (body) => {
              try {
                await apiService.updateForumComment(node.id, body)
                setEditingId(null)
                await load()
              } catch (err) {
                setError(apiService.errorMessage(err))
              }
            }}
          />
        ) : (
          <>
            <div className="mt-2">
              <Markdown content={node.body} />
            </div>
            <AttachmentList attachments={node.attachments} />
          </>
        )}

        <div className="mt-2 flex items-center gap-3 text-xs">
          <button
            onClick={() => handleLike(node.id)}
            className={`inline-flex items-center gap-1 transition hover:text-pink-600 ${
              node.liked_by_me ? 'text-pink-600' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Heart size={13} className={node.liked_by_me ? 'fill-current' : ''} /> {node.like_count || 0}
          </button>
          {!isLocked && (
            <button
              onClick={() => setReplyingTo(replyingTo === node.id ? null : node.id)}
              className="inline-flex items-center gap-1 text-gray-500 transition hover:text-yellow-600 dark:text-gray-400"
            >
              <Reply size={13} /> Reply
            </button>
          )}
          {node.can_edit && (
            <>
              <button
                onClick={() => setEditingId(node.id)}
                className="inline-flex items-center gap-1 text-gray-500 transition hover:text-yellow-600 dark:text-gray-400"
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                onClick={() => handleDelete(node.id)}
                className="inline-flex items-center gap-1 text-gray-500 transition hover:text-red-600 dark:text-gray-400"
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {replyingTo === node.id && !isLocked && (
        <div className="ml-5 mt-2">
          <CommentComposer
            postId={postId}
            parentId={node.id}
            placeholder="Write a reply…"
            onCancel={() => setReplyingTo(null)}
            onCreated={async () => {
              setReplyingTo(null)
              await load()
            }}
          />
        </div>
      )}

      {node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  )

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
        <CornerDownRight size={16} className="text-gray-400" />
        {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
      </h3>

      {!isLocked && (
        <div className="mt-3">
          <CommentComposer postId={postId} placeholder="Share your thoughts…" onCreated={load} />
        </div>
      )}
      {isLocked && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          This discussion is locked. New comments are disabled.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading comments…
        </div>
      ) : (
        <div className="mt-2">{tree.map((node) => renderNode(node, 0))}</div>
      )}
    </div>
  )
}

function InlineEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  return (
    <div className="mt-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />
      <div className="mt-1.5 flex gap-2">
        <button
          disabled={saving || !value.trim()}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave(value)
            } finally {
              setSaving(false)
            }
          }}
          className="rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-60"
        >
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

function CommentComposer({
  postId,
  parentId,
  placeholder,
  onCreated,
  onCancel,
}: {
  postId: number
  parentId?: number
  placeholder?: string
  onCreated: () => Promise<void> | void
  onCancel?: () => void
}) {
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<ForumAttachment[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await apiService.createForumComment(postId, {
        body,
        parent_comment_id: parentId ?? null,
        attachment_ids: attachments.map((a) => a.id),
      })
      setBody('')
      setAttachments([])
      await onCreated()
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-700/70 dark:bg-gray-800/40">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder || 'Write a comment…'}
        rows={3}
        className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <AttachmentPicker pending={attachments} onChange={setAttachments} onError={setError} />
        <div className="flex gap-2">
          {onCancel && (
            <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            disabled={submitting || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-60"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {parentId ? 'Reply' : 'Comment'}
          </button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  )
}
