import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Eye,
  Heart,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { apiService } from '@/services/api'
import type { ForumPost } from '@/types/domain'
import { Markdown } from './Markdown'
import { AttachmentList } from './attachments'
import { CommentThread } from './CommentThread'
import { PostComposer } from './PostComposer'
import { communityById } from './constants'

function initials(name?: string | null, fallback?: string | null): string {
  const n = name || fallback || '?'
  return n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso + (iso.endsWith('Z') ? '' : 'Z')), { addSuffix: true })
  } catch {
    return ''
  }
}

interface PostDetailProps {
  postId: number
  onBack: () => void
  onDeleted: () => void
}

export function PostDetail({ postId, onBack, onDeleted }: PostDetailProps) {
  const [post, setPost] = useState<ForumPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const load = async () => {
    try {
      setPost(await apiService.getForumPost(postId))
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

  const like = async () => {
    if (!post) return
    try {
      const res = await apiService.likeForumPost(post.id)
      setPost({ ...post, liked_by_me: res.liked, like_count: res.like_count })
    } catch {
      /* ignore */
    }
  }

  const moderate = async (payload: { is_pinned?: boolean; is_locked?: boolean }) => {
    if (!post) return
    try {
      setPost(await apiService.moderateForumPost(post.id, payload))
    } catch (err) {
      setError(apiService.errorMessage(err))
    }
  }

  const remove = async () => {
    if (!post || !window.confirm('Delete this post? This cannot be undone.')) return
    try {
      await apiService.deleteForumPost(post.id)
      onDeleted()
    } catch (err) {
      setError(apiService.errorMessage(err))
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-gray-400">
        <Loader2 className="animate-spin" /> Loading post…
      </div>
    )
  }

  if (error && !post) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
        {error}
        <button onClick={onBack} className="ml-2 underline">Go back</button>
      </div>
    )
  }

  if (!post) return null

  const community = communityById(post.community_id)

  if (editing) {
    return (
      <div>
        <button onClick={() => setEditing(false)} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          <ArrowLeft size={15} /> Back to post
        </button>
        <PostComposer
          communityId={post.community_id}
          existing={post}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setPost(updated)
            setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-gray-500 transition hover:text-gray-700 dark:hover:text-gray-300">
        <ArrowLeft size={15} /> Back to {community.name}
      </button>

      <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-yellow-500 to-amber-500 text-sm font-semibold text-white">
              {initials(post.author?.full_name, post.author?.username)}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {post.author?.full_name || post.author?.username || 'Unknown'}
              </p>
              <p className="text-xs text-gray-400">
                {timeAgo(post.created_at)}
                {post.updated_at !== post.created_at && ' · edited'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {post.is_pinned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                <Pin size={11} /> Pinned
              </span>
            )}
            {post.is_locked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                <Lock size={11} /> Locked
              </span>
            )}
          </div>
        </div>

        <h1 className="mt-4 text-xl font-bold text-gray-900 dark:text-white">{post.title}</h1>

        {post.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {post.tags.map((t) => (
              <span key={t} className="rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Markdown content={post.body} />
        </div>

        <AttachmentList attachments={post.attachments} />

        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3 text-sm dark:border-gray-700/60">
          <button
            onClick={like}
            className={`inline-flex items-center gap-1.5 transition hover:text-pink-600 ${
              post.liked_by_me ? 'text-pink-600' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Heart size={16} className={post.liked_by_me ? 'fill-current' : ''} /> {post.like_count}
          </button>
          <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <MessageSquare size={16} /> {post.comment_count}
          </span>
          <span className="inline-flex items-center gap-1.5 text-gray-400">
            <Eye size={16} /> {post.view_count}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {post.can_moderate && (
              <>
                <button
                  onClick={() => moderate({ is_pinned: !post.is_pinned })}
                  title={post.is_pinned ? 'Unpin' : 'Pin'}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-amber-600 dark:hover:bg-gray-700"
                >
                  {post.is_pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
                <button
                  onClick={() => moderate({ is_locked: !post.is_locked })}
                  title={post.is_locked ? 'Unlock' : 'Lock'}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
                >
                  {post.is_locked ? <LockOpen size={16} /> : <Lock size={16} />}
                </button>
              </>
            )}
            {post.can_edit && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  title="Edit"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-yellow-600 dark:hover:bg-gray-700"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={remove}
                  title="Delete"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-700"
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </article>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <CommentThread
          postId={post.id}
          isLocked={post.is_locked}
          onCountChange={(count) => setPost((p) => (p ? { ...p, comment_count: count } : p))}
        />
      </div>
    </div>
  )
}
