import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, CircleDot, ExternalLink, FileCode2, FolderGit2, GitBranch, GitCommit,
  Github, HardDrive, Loader2, RefreshCw, Star, Users, Workflow, XCircle,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService, CONNECTION_STATUS_CHANGED_EVENT } from '@/services/api'
import type { ProjectGithubOverview } from '@/types/domain'
import StarterProjectCard from './StarterProjectCard'

type GithubLink = { github_token_set: boolean; github_repo_url: string }

function timeAgo(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const units: [number, string][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [2592000, 'month'], [31536000, 'year']]
  let label = `${seconds}s ago`
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const [size, unit] = units[i]
    if (seconds >= size) {
      const n = Math.floor(seconds / size)
      label = `${n} ${unit}${n === 1 ? '' : 's'} ago`
      break
    }
  }
  return label
}

const LANGUAGE_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500', 'bg-lime-500', 'bg-gray-400']

function Card({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-3 py-2.5 min-w-0">
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 truncate text-sm font-semibold text-gray-900 dark:text-white">{value ?? '—'}</div>
    </div>
  )
}

function Chips({ items, tone = 'gray' }: { items: string[]; tone?: 'gray' | 'blue' | 'green' }) {
  if (!items.length) return <span className="text-xs text-gray-400">None detected</span>
  const tones = {
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => (
        <span key={item} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{item}</span>
      ))}
    </div>
  )
}

function FileList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-gray-400">{empty}</p>
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
      {items.map(item => (
        <li key={item} className="truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={item}>{item}</li>
      ))}
    </ul>
  )
}

function WorkflowBadge({ run }: { run: NonNullable<ProjectGithubOverview['repository']['latest_workflow_run']> }) {
  const outcome = run.conclusion || run.status || 'unknown'
  const ok = outcome === 'success'
  const failed = ['failure', 'cancelled', 'timed_out', 'startup_failure'].includes(outcome)
  const Icon = ok ? CheckCircle2 : failed ? XCircle : CircleDot
  const color = ok ? 'text-emerald-600' : failed ? 'text-rose-600' : 'text-amber-500'
  return (
    <span className={`inline-flex items-center gap-1 ${color}`}><Icon size={14} />{outcome.replace(/_/g, ' ')}</span>
  )
}

export default function OverviewTab() {
  const navigate = useNavigate()
  const projects = useAppStore(s => s.projects)
  const selectedProjectId = useAppStore(s => s.selectedProjectId)
  const ghStatus = useAppStore(s => s.ghStatus)
  const selectedProject = projects.find(p => p.id === selectedProjectId) || null

  const [link, setLink] = useState<GithubLink | null>(null)
  const [overview, setOverview] = useState<ProjectGithubOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (refresh = false) => {
    if (!selectedProjectId) return
    const current = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const github = await apiService.getProjectGithub(selectedProjectId)
      if (current !== requestId.current) return
      setLink(github)
      if (!github.github_token_set || !github.github_repo_url) {
        setOverview(null)
        return
      }
      const data = await apiService.getProjectGithubOverview(selectedProjectId, refresh)
      if (current === requestId.current) setOverview(data)
    } catch (e) {
      if (current === requestId.current) {
        setOverview(null)
        setError(apiService.errorMessage(e))
      }
    } finally {
      if (current === requestId.current) setLoading(false)
    }
  }, [selectedProjectId])

  useEffect(() => {
    setLink(null)
    setOverview(null)
    void load()
  }, [load, ghStatus])

  // Re-detect as soon as the GitHub connection is saved in Settings (possibly in another tab).
  useEffect(() => {
    const onChange = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind
      if (!kind || kind === 'github') void load(true)
    }
    window.addEventListener(CONNECTION_STATUS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(CONNECTION_STATUS_CHANGED_EVENT, onChange)
  }, [load])

  if (!selectedProject) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <FolderGit2 size={28} className="mb-3 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a project to see its overview</p>
      </div>
    )
  }

  const connected = Boolean(link?.github_token_set && link?.github_repo_url)
  const goToGithubSettings = () => navigate('/settings/mcp/github')
  const repo = overview?.repository
  const detection = overview?.detection
  const local = overview?.local

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-4 pr-1">
      {/* Header */}
      <section className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{selectedProject.name}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{selectedProject.description || repo?.description || 'No description'}</p>
            {repo?.html_url && (
              <a href={repo.html_url} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                <Github size={14} />{repo.full_name}<ExternalLink size={12} />
              </a>
            )}
          </div>
          {connected && (
            <div className="flex items-center gap-2">
              {overview && <span className="text-xs text-gray-400">Detected {timeAgo(overview.analyzed_at.endsWith('Z') ? overview.analyzed_at : `${overview.analyzed_at}Z`)}</span>}
              <button onClick={() => void load(true)} disabled={loading} className="btn-secondary px-3 py-1.5 text-xs">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Re-detect
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Not connected */}
      {link && !connected && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5 dark:border-blue-500/30 dark:bg-blue-500/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Github size={22} className="mt-0.5 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Connect this project to GitHub</p>
                <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                  {link.github_token_set
                    ? 'A token is saved, but no repository URL is set yet.'
                    : 'Add a repository URL and access token. Once connected, ATM detects languages, test frameworks, CI status and more automatically.'}
                </p>
              </div>
            </div>
            <button onClick={goToGithubSettings} className="btn-primary px-4 py-2 text-sm">
              <Github size={14} />Connect GitHub
            </button>
          </div>
        </section>
      )}

      {link && !connected && <StarterProjectCard key={selectedProject.id} projectId={selectedProject.id} projectName={selectedProject.name} />}

      {loading && !overview && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 py-10 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />Analysing the repository…
        </div>
      )}

      {error && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <span className="flex items-center gap-2"><AlertTriangle size={16} />{error}</span>
          <button onClick={goToGithubSettings} className="text-xs font-semibold underline">Check GitHub settings</button>
        </section>
      )}

      {repo && detection && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Repository" icon={<Github size={15} />}>
            <div className="grid gap-2 sm:grid-cols-3">
              <Fact label="Visibility" value={<span className="capitalize">{repo.visibility}{repo.archived ? ' · archived' : ''}</span>} />
              <Fact label="Default branch" value={repo.default_branch} />
              <Fact label="Branches" value={repo.branches_count} />
              <Fact label="Last push" value={timeAgo(repo.pushed_at)} />
              <Fact label="Created" value={repo.created_at ? new Date(repo.created_at).toLocaleDateString() : '—'} />
              <Fact label="Size" value={repo.size_kb != null ? `${(repo.size_kb / 1024).toFixed(1)} MB` : '—'} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1"><Star size={13} />{repo.stars ?? 0} stars</span>
              <span className="inline-flex items-center gap-1"><GitBranch size={13} />{repo.forks ?? 0} forks</span>
              <span className="inline-flex items-center gap-1"><CircleDot size={13} />{repo.open_issues ?? 0} open issues</span>
              {repo.license && <span>License: {repo.license}</span>}
            </div>
            {repo.languages.length > 0 && (
              <div className="mt-4">
                <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  {repo.languages.map((lang, i) => (
                    <div key={lang.name} className={LANGUAGE_COLORS[i % LANGUAGE_COLORS.length]} style={{ width: `${lang.percent}%` }} title={`${lang.name} ${lang.percent}%`} />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
                  {repo.languages.map((lang, i) => (
                    <span key={lang.name} className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${LANGUAGE_COLORS[i % LANGUAGE_COLORS.length]}`} />{lang.name} {lang.percent}%
                    </span>
                  ))}
                </div>
              </div>
            )}
            {repo.topics.length > 0 && <div className="mt-3"><Chips items={repo.topics} /></div>}
          </Card>

          <Card title="Activity" icon={<GitCommit size={15} />}>
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-3">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Latest commit on {overview?.branch}</p>
                {repo.latest_commit?.sha ? (
                  <>
                    <p className="mt-1 truncate text-sm font-medium text-gray-900 dark:text-white" title={repo.latest_commit.message}>{repo.latest_commit.message || '(no message)'}</p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {repo.latest_commit.html_url
                        ? <a href={repo.latest_commit.html_url} target="_blank" rel="noreferrer" className="font-mono text-blue-600 hover:underline dark:text-blue-400">{repo.latest_commit.sha.slice(0, 7)}</a>
                        : <span className="font-mono">{repo.latest_commit.sha.slice(0, 7)}</span>}
                      {' · '}{repo.latest_commit.author || 'unknown'} · {timeAgo(repo.latest_commit.date)}
                    </p>
                  </>
                ) : <p className="mt-1 text-xs text-gray-400">Not available</p>}
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-3">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Latest CI run (GitHub Actions)</p>
                {repo.latest_workflow_run?.name ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{repo.latest_workflow_run.name}</span>
                    <WorkflowBadge run={repo.latest_workflow_run} />
                    <span className="text-xs text-gray-500">{repo.latest_workflow_run.branch} · {timeAgo(repo.latest_workflow_run.created_at)}</span>
                    {repo.latest_workflow_run.html_url && (
                      <a href={repo.latest_workflow_run.html_url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400"><ExternalLink size={13} /></a>
                    )}
                  </div>
                ) : <p className="mt-1 text-xs text-gray-400">No workflow runs found</p>}
              </div>
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400"><Users size={12} />Top contributors</p>
                {repo.contributors.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {repo.contributors.map(c => (
                      <a key={c.login} href={c.html_url} target="_blank" rel="noreferrer"
                        className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300">
                        {c.login} <span className="text-gray-400">{c.contributions}</span>
                      </a>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-400">Not available</p>}
              </div>
            </div>
          </Card>

          <Card title="Detected test setup" icon={<FileCode2 size={15} />}>
            {!detection.tree_available ? (
              <p className="text-xs text-gray-400">The file tree could not be read for branch {overview?.branch}.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">Frameworks</p>
                  <Chips items={detection.frameworks} tone="blue" />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">Build tools</p>
                  <Chips items={detection.build_tools} tone="green" />
                </div>
                {Object.keys(detection.test_files).length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {Object.entries(detection.test_files).map(([label, count]) => <Fact key={label} label={label} value={count} />)}
                  </div>
                )}
                {detection.maven && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Fact label="Maven artifact" value={detection.maven.artifact} />
                    <Fact label="Java release" value={detection.maven.java_release} />
                    {detection.maven.appium_java_client && <Fact label="Appium java-client" value={detection.maven.appium_java_client} />}
                    {detection.maven.selenium && <Fact label="Selenium" value={detection.maven.selenium} />}
                  </div>
                )}
                {detection.package_json && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">package.json {detection.package_json.name ? `(${detection.package_json.name})` : ''}</p>
                    <Chips items={Object.entries(detection.package_json.test_libraries).map(([lib, version]) => `${lib} ${version}`)} />
                    {detection.package_json.scripts.length > 0 && (
                      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Scripts: {detection.package_json.scripts.join(', ')}</p>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {detection.files_count.toLocaleString()} files analysed{detection.has_readme ? ' · README present' : ''}
                  {detection.tree_truncated && ' · the repository is large, so GitHub returned a partial file list'}
                </p>
              </div>
            )}
          </Card>

          <Card title="Structure" icon={<Workflow size={15} />}>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">Top-level folders</p>
                <Chips items={detection.top_level_folders} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">.properties files ({detection.properties_files.length})</p>
                  <FileList items={detection.properties_files} empty="None" />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">CI workflows ({detection.workflows.length})</p>
                  <FileList items={detection.workflows} empty="No .github/workflows found" />
                </div>
              </div>
              {detection.collections.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">Test collections ({detection.collections.length})</p>
                  <FileList items={detection.collections} empty="None" />
                </div>
              )}
            </div>
          </Card>

          <Card title="Local checkout" icon={<HardDrive size={15} />}
            action={<Link to="/work/workspace?view=three-panel" className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">Manage</Link>}>
            {local?.is_git_repo ? (
              <div className="space-y-3">
                <p className="truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={local.path}>{local.path}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Fact label="Checked-out branch" value={local.current_branch} />
                  <Fact label="Working tree" value={local.dirty
                    ? <span className="text-amber-600">Uncommitted changes</span>
                    : <span className="text-emerald-600">Clean</span>} />
                  <Fact label="Last local commit" value={timeAgo(local.last_commit?.date)} />
                </div>
                {local.last_commit && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{local.last_commit.message}</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                No local clone yet. Use <Link to="/work/workspace?view=three-panel" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Work › Workspace › Repository</Link> to clone or link one, so runs can execute on this station.
              </p>
            )}
          </Card>
        </div>
      )}

    </div>
  )
}
