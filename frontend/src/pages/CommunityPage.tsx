import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Heart,
  Link2,
  Lock,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { apiService } from '@/services/api'
import type { ForumPost, ForumAttachment } from '@/types/domain'
import { communityById } from '@/components/community/constants'
import { PostComposer } from '@/components/community/PostComposer'
import { PostDetail } from '@/components/community/PostDetail'
import { MediaPreview } from '@/components/community/attachments'

function slugifyTeam(team: string): string {
  return team.trim().toLowerCase().replace(/\s+/g, '-')
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso + (iso.endsWith('Z') ? '' : 'Z')), { addSuffix: true })
  } catch {
    return ''
  }
}

function initials(name?: string | null, fallback?: string | null): string {
  const n = name || fallback || '?'
  return n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

function PostCard({ post, onOpen }: { post: ForumPost; onOpen: () => void }) {
  const excerpt = post.body.replace(/[#*`>_~[\]()!-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)

  const getFileIcon = (attachment: ForumAttachment) => {
    const ext = attachment.original_name.split('.').pop()?.toLowerCase() || ''
    if (ext === 'pdf') return '📕'
    if (['doc', 'docx'].includes(ext)) return '📄'
    if (['xlsx', 'xls'].includes(ext)) return '📊'
    if (['ppt', 'pptx'].includes(ext)) return '🎯'
    if (ext === 'txt') return '📝'
    return '📎'
  }

  return (
    <button
      onClick={onOpen}
      className="group w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-soft transition hover:border-yellow-300 hover:shadow-soft-lg dark:border-gray-700/70 dark:bg-gray-800/90 dark:hover:border-yellow-500/50"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-yellow-500 to-amber-500 text-[11px] font-semibold text-white">
          {initials(post.author?.full_name, post.author?.username)}
        </div>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {post.author?.full_name || post.author?.username || 'Unknown'}
        </span>
        <span className="text-xs text-gray-400">· {timeAgo(post.created_at)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {post.is_pinned && <Pin size={14} className="text-amber-500" />}
          {post.is_locked && <Lock size={14} className="text-gray-400" />}
        </div>
      </div>

      <h3 className="mt-2.5 text-base font-semibold text-gray-900 transition group-hover:text-yellow-600 dark:text-white dark:group-hover:text-yellow-400">
        {post.title}
      </h3>
      {excerpt && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {excerpt}
          {post.body.length > 180 ? '…' : ''}
        </p>
      )}

      {post.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {post.tags.map((t) => (
            <span key={t} className="rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300">
              #{t}
            </span>
          ))}
        </div>
      )}

      {post.attachments && post.attachments.length > 0 && (
        <div className="mt-3 space-y-3">
          {/* Image and Video Previews */}
          <div className="space-y-2">
            {post.attachments
              .filter((att) => att.kind === 'image' || att.kind === 'video')
              .map((att) => (
                <div
                  key={att.id}
                  className={`overflow-hidden rounded-lg border border-amber-100 dark:border-amber-500/20 ${
                    att.kind === 'video' ? 'bg-black' : ''
                  }`}
                >
                  <MediaPreview
                    attachment={att}
                    className={
                      att.kind === 'image'
                        ? 'w-full h-auto max-h-48 object-cover'
                        : 'w-full h-auto max-h-48'
                    }
                  />
                </div>
              ))}
          </div>

          {/* Document and File List */}
          {post.attachments.some((att) => ['document', 'other'].includes(att.kind)) && (
            <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-2.5 dark:border-amber-500/20 dark:bg-amber-500/5">
              <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2">📎 Files ({post.attachments.length})</div>
              <div className="space-y-1">
                {post.attachments.map((att) => (
                  <div key={att.id} className="flex items-center gap-2 text-xs">
                    <span>{getFileIcon(att)}</span>
                    <span className="truncate text-gray-600 dark:text-gray-300">{att.original_name}</span>
                    {att.file_size && <span className="text-gray-400 text-[10px] whitespace-nowrap">({Math.round(att.file_size / 1024)}kb)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
        <span className={`inline-flex items-center gap-1 ${post.liked_by_me ? 'text-pink-500' : ''}`}>
          <Heart size={13} className={post.liked_by_me ? 'fill-current' : ''} /> {post.like_count}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare size={13} /> {post.comment_count}
        </span>
      </div>
    </button>
  )
}

const CATEGORIES = [
  { id: 'projects', label: 'Projects Topics', icon: '📁', color: 'yellow' },
  { id: 'upskilling', label: 'Upskilling Topics', icon: '📚', color: 'yellow' },
  { id: 'chat', label: 'Chat and Chill', icon: '💬', color: 'yellow' },
  { id: 'platform', label: 'Platform Issues', icon: '⚙️', color: 'yellow' },
]

export default function CommunityPage() {
  const communityId = 'qa' // Only QA community

  const [posts, setPosts] = useState<ForumPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sort, setSort] = useState<'latest' | 'top'>('latest')
  const [composerOpen, setComposerOpen] = useState(false)
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null)
  const [availableTags, setAvailableTags] = useState<Array<{ name: string; count: number }>>([])
  const [displayTags, setDisplayTags] = useState<Array<{ name: string; count: number }>>([])
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [loadingTags, setLoadingTags] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('projects')

  // Jira project connection (drives the "Projects Topics" category)
  const [jiraConnected, setJiraConnected] = useState(false)
  const [jiraLoading, setJiraLoading] = useState(true)
  const [jiraProjectKey, setJiraProjectKey] = useState<string | null>(null)
  const [jiraProjectName, setJiraProjectName] = useState<string | null>(null)
  const [teams, setTeams] = useState<string[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<string>('all')

  const community = communityById(communityId)

  // Check whether a Jira project is connected (required for Projects Topics)
  useEffect(() => {
    const loadJiraConnection = async () => {
      setJiraLoading(true)
      try {
        const settings = await apiService.getJiraSettings()
        const connected = Boolean(settings.jira_token_set && settings.jira_mcp_base_url && settings.jira_project_key)
        setJiraConnected(connected)
        setJiraProjectKey(settings.jira_project_key || null)
        setJiraProjectName(settings.jira_project_name || null)
      } catch {
        setJiraConnected(false)
        setJiraProjectKey(null)
        setJiraProjectName(null)
      } finally {
        setJiraLoading(false)
      }
    }
    void loadJiraConnection()
  }, [])

  // Load teams (derived from epics) for the connected Jira project
  useEffect(() => {
    if (!jiraConnected || !jiraProjectKey) {
      setTeams([])
      return
    }
    const loadTeams = async () => {
      setTeamsLoading(true)
      try {
        const data = await apiService.getEpicStories(jiraProjectKey)
        const teamSet = new Set<string>()
        data.epics.forEach((epic) => {
          if (epic.team) teamSet.add(epic.team.trim())
        })
        setTeams(Array.from(teamSet).sort())
      } catch {
        setTeams([])
      } finally {
        setTeamsLoading(false)
      }
    }
    void loadTeams()
  }, [jiraConnected, jiraProjectKey])

  // Load available tags
  useEffect(() => {
    const loadTags = async () => {
      setLoadingTags(true)
      try {
        const res = await apiService.getAvailableForumTags(communityId)
        setAvailableTags(res.tags)
      } catch (err) {
        console.error('Failed to load tags:', err)
      } finally {
        setLoadingTags(false)
      }
    }
    void loadTags()
  }, [])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiService.listForumPosts({
        communityId,
        search,
        sort,
        tags: selectedTags.size > 0 ? Array.from(selectedTags) : undefined,
        pageSize: 50,
      })
      setPosts(res.items)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [search, sort, selectedTags])

  // Posts visible in the current category/team scope
  const filteredPosts = posts.filter((post) => {
    if (!post.tags.includes(selectedCategory)) return false
    if (selectedCategory === 'projects' && selectedTeam !== 'all') {
      return post.tags.includes(slugifyTeam(selectedTeam))
    }
    return true
  })

  // Filter display tags based on which tags appear in posts of the current category/team
  useEffect(() => {
    const tagsInPosts = new Set<string>()
    filteredPosts.forEach((post) => {
      post.tags.forEach((tag) => tagsInPosts.add(tag))
    })
    const filtered = availableTags.filter((tag) => tagsInPosts.has(tag.name))
    setDisplayTags(filtered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, availableTags, selectedCategory, selectedTeam])

  useEffect(() => {
    if (selectedPostId === null && !composerOpen) void loadPosts()
  }, [loadPosts, selectedPostId, composerOpen])

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Toggle tag selection
  const toggleTag = (tag: string) => {
    const newSelected = new Set(selectedTags)
    if (newSelected.has(tag)) {
      newSelected.delete(tag)
    } else {
      newSelected.add(tag)
    }
    setSelectedTags(newSelected)
  }

  // Clear all tag filters
  const clearTagFilters = () => {
    setSelectedTags(new Set())
  }

  if (selectedPostId !== null) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl p-1 sm:p-2">
          <PostDetail
            postId={selectedPostId}
            onBack={() => setSelectedPostId(null)}
            onDeleted={() => {
              setSelectedPostId(null)
              void loadPosts()
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-1 sm:p-2">
        {/* Header */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-50 text-2xl dark:bg-purple-500/10">
              <UsersRound size={22} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Quality Assurance Forum</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Share testing experience, ask questions, and learn from your peers.
              </p>
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2 overflow-x-auto pb-2">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              onClick={() => {
                setSelectedCategory(category.id)
                setSearch('')
                setSearchInput('')
                setSelectedTags(new Set())
                setSelectedTeam('all')
              }}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition whitespace-nowrap ${
                selectedCategory === category.id
                  ? 'bg-yellow-500 text-white shadow-sm'
                  : 'bg-white text-gray-700 border border-gray-200 hover:border-yellow-300 hover:bg-yellow-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-yellow-400 dark:hover:bg-gray-700/50'
              }`}
            >
              <span>{category.icon}</span>
              {category.label}
            </button>
          ))}
        </div>

        {/* Team Sub-tabs (Projects Topics only, requires connected Jira project) */}
        {selectedCategory === 'projects' && jiraConnected && (
          <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {jiraProjectName || jiraProjectKey} teams:
            </span>
            <button
              onClick={() => setSelectedTeam('all')}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition whitespace-nowrap ${
                selectedTeam === 'all'
                  ? 'bg-yellow-500 text-white shadow-sm'
                  : 'bg-white text-gray-700 border border-gray-200 hover:border-yellow-300 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-yellow-400'
              }`}
            >
              All Teams
            </button>
            {teamsLoading ? (
              <span className="text-xs text-gray-400">Loading teams…</span>
            ) : teams.length === 0 ? (
              <span className="text-xs text-gray-400">No teams found in connected project</span>
            ) : (
              teams.map((team) => (
                <button
                  key={team}
                  onClick={() => setSelectedTeam(team)}
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition whitespace-nowrap ${
                    selectedTeam === team
                      ? 'bg-yellow-500 text-white shadow-sm'
                      : 'bg-white text-gray-700 border border-gray-200 hover:border-yellow-300 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-yellow-400'
                  }`}
                >
                  {team}
                </button>
              ))
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={`Search in ${community.name}…`}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="flex rounded-lg border border-gray-300 p-0.5 dark:border-gray-600">
            {(['latest', 'top'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                  sort === s ? 'bg-yellow-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {s === 'top' && <Sparkles size={12} />}
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => setComposerOpen(true)}
            disabled={selectedCategory === 'projects' && (!jiraConnected || selectedTeam === 'all')}
            title={
              selectedCategory === 'projects' && !jiraConnected
                ? 'Connect a Jira project in Settings first'
                : selectedCategory === 'projects' && selectedTeam === 'all'
                ? 'Select a team first'
                : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-500 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-yellow-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-yellow-500"
          >
            <Plus size={16} /> New post
          </button>
        </div>

        {/* Tag Filter Cloud */}
        {displayTags.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-gradient-to-r from-yellow-50/50 to-amber-50/50 p-4 dark:border-gray-700/50 dark:from-gray-800/40 dark:to-gray-800/20">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">Filter by tags</h3>
              {selectedTags.size > 0 && (
                <button
                  onClick={clearTagFilters}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {loadingTags ? (
                <div className="text-xs text-gray-400">Loading tags…</div>
              ) : displayTags.length === 0 ? (
                <div className="text-xs text-gray-400">No tags yet</div>
              ) : (
                displayTags.map((tag) => {
                  const isSelected = selectedTags.has(tag.name)
                  return (
                    <button
                      key={tag.name}
                      onClick={() => toggleTag(tag.name)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                        isSelected
                          ? 'bg-yellow-500 text-white shadow-sm'
                          : 'bg-white text-gray-700 border border-gray-200 hover:border-yellow-300 hover:text-yellow-600 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-yellow-400 dark:hover:text-yellow-300'
                      }`}
                    >
                      #{tag.name}
                      <span className={`text-[11px] font-semibold ${isSelected ? 'text-yellow-100' : 'text-gray-400'}`}>
                        {tag.count}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Selected tags summary */}
        {selectedTags.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-yellow-50 px-4 py-2 text-xs dark:bg-yellow-500/10">
            <span className="font-medium text-yellow-700 dark:text-yellow-300">
              Filtering by {selectedTags.size} tag{selectedTags.size !== 1 ? 's' : ''}:
            </span>
            <div className="flex flex-wrap gap-1">
              {Array.from(selectedTags).map((tag) => (
                <div key={tag} className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 dark:bg-yellow-500/20">
                  <span className="text-yellow-700 dark:text-yellow-300">#{tag}</span>
                  <button
                    onClick={() => toggleTag(tag)}
                    className="text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-300"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {composerOpen && (
          <PostComposer
            communityId={communityId}
            initialCategory={selectedCategory}
            initialTeam={selectedCategory === 'projects' && selectedTeam !== 'all' ? slugifyTeam(selectedTeam) : undefined}
            onCancel={() => setComposerOpen(false)}
            onSaved={(post) => {
              setComposerOpen(false)
              setSelectedPostId(post.id)
            }}
          />
        )}

        {/* Feed */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
            {error}
          </div>
        )}

        {selectedCategory === 'projects' && !jiraLoading && !jiraConnected ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-10 text-center dark:border-amber-500/30 dark:bg-amber-500/5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-2xl dark:bg-amber-500/10">
              🔌
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">No Jira project connected</p>
            <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
              Connect a Jira project in Settings to see and create Projects Topics posts related to your teams.
            </p>
            <Link
              to="/settings/jira"
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-yellow-500 px-3 py-2 text-sm font-medium text-white hover:bg-yellow-600"
            >
              <Link2 size={16} /> Connect Jira
            </Link>
          </div>
        ) : loading || (selectedCategory === 'projects' && jiraLoading) ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800/60" />
            ))}
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/50 p-10 text-center dark:border-gray-600 dark:bg-gray-800/40">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-2xl dark:bg-purple-500/10">
              {CATEGORIES.find((c) => c.id === selectedCategory)?.icon || community.icon}
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {search || selectedTags.size > 0
                ? 'No results found'
                : selectedCategory === 'projects' && selectedTeam !== 'all'
                ? `No posts yet for team "${selectedTeam}"`
                : `No posts yet in ${CATEGORIES.find((c) => c.id === selectedCategory)?.label}`}
            </p>
            <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
              {search
                ? 'Try a different search term or browse by tags.'
                : selectedTags.size > 0
                ? 'Try different tags.'
                : selectedCategory === 'projects' && selectedTeam === 'all'
                ? 'Select a team above to create the first post.'
                : 'Be the first to start a discussion!'}
            </p>
            {!search && selectedTags.size === 0 && !(selectedCategory === 'projects' && selectedTeam === 'all') && (
              <button
                onClick={() => setComposerOpen(true)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-yellow-500 px-3 py-2 text-sm font-medium text-white hover:bg-yellow-600"
              >
                <Plus size={16} /> Create the first post
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3 pb-6">
            {filteredPosts.map((post) => (
              <PostCard key={post.id} post={post} onOpen={() => setSelectedPostId(post.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
