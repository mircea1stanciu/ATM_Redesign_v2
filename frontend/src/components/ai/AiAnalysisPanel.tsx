import type { ReactNode } from 'react'
import {
  AlertTriangle, FileCode2, FolderTree, GitBranch, Layers, Loader2, MessageSquarePlus, PlayCircle, RefreshCw, Sparkles,
} from 'lucide-react'
import type { AiProjectAnalysis } from '@/types/domain'

export interface PromptRequest {
  content: string
  attachments?: string[]
  runId?: string | null
}

const BAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500']

function Card({ title, icon, children, className = '' }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200/80 bg-white p-4 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90 ${className}`}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">{icon}{title}</h3>
      {children}
    </section>
  )
}

function Chips({ items, empty = 'None detected' }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="text-xs text-gray-400">{empty}</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => (
        <span key={item} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{item}</span>
      ))}
    </div>
  )
}

export default function AiAnalysisPanel({
  analysis,
  loading,
  error,
  onRefresh,
  onPrompt,
}: {
  analysis: AiProjectAnalysis | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onPrompt: (request: PromptRequest) => void
}) {
  if (!analysis) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        {loading ? <><Loader2 size={16} className="animate-spin" /> Analysing the local project…</> : error}
      </div>
    )
  }

  const changed = analysis.git.changed_files
  const testExamples = analysis.test_files.slice(0, 40)
  const quickPrompts: { label: string; request: PromptRequest; icon: ReactNode }[] = [
    {
      label: 'Suggest which tests are missing',
      icon: <Sparkles size={14} />,
      request: { content: 'Review the existing tests and suggest the most valuable tests or scenarios that are missing. Group them by priority and explain why.' },
    },
    {
      label: 'Explain the structure and conventions',
      icon: <FolderTree size={14} />,
      request: { content: 'Explain how this project is organised (frameworks, folders, helpers, configuration, test data) and the conventions a new test should follow.' },
    },
    {
      label: 'Write a new test…',
      icon: <MessageSquarePlus size={14} />,
      request: { content: 'Write a new test that verifies: <describe the feature / scenario>. Follow the existing conventions and reuse existing helpers.' },
    },
    ...(changed.length ? [{
      label: `Review my ${changed.length} uncommitted change${changed.length === 1 ? '' : 's'}`,
      icon: <GitBranch size={14} />,
      request: {
        content: 'Review my uncommitted changes (attached) for bugs, missing assertions and convention issues, and propose fixes.',
        attachments: changed.map(c => c.path).filter(p => analysis.files.includes(p)).slice(0, 12),
      },
    }] : []),
  ]

  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto pr-1">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200/80 bg-white px-4 py-3 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={analysis.path}>{analysis.path}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {analysis.files_count.toLocaleString()} files{analysis.files_truncated ? '+' : ''}
            {analysis.git.branch && <> · branch <b>{analysis.git.branch}</b></>}
            {analysis.git.changed_count > 0 && <> · <span className="text-amber-600">{analysis.git.changed_count} uncommitted changes</span></>}
            {' · '}analysed {new Date(analysis.analyzed_at).toLocaleTimeString()}
          </p>
        </div>
        <button onClick={onRefresh} disabled={loading} className="btn-secondary px-3 py-1.5 text-xs">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Re-analyse
        </button>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-500/30 dark:bg-blue-500/10">
        <p className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">What would you like the assistant to do?</p>
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map(prompt => (
            <button key={prompt.label} onClick={() => onPrompt(prompt.request)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-blue-500/10">
              {prompt.icon}{prompt.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Languages & frameworks" icon={<Layers size={15} />}>
          {analysis.languages.length > 0 && (
            <>
              <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                {analysis.languages.map((lang, i) => (
                  <div key={lang.name} className={BAR_COLORS[i % BAR_COLORS.length]} style={{ width: `${lang.percent}%` }} title={`${lang.name} ${lang.percent}%`} />
                ))}
              </div>
              <div className="mb-3 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
                {analysis.languages.map((lang, i) => (
                  <span key={lang.name} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`} />{lang.name} · {lang.files} files
                  </span>
                ))}
              </div>
            </>
          )}
          <p className="mb-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">Frameworks and build tools</p>
          <Chips items={[...analysis.frameworks, ...analysis.build_tools]} />
          {analysis.maven && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Maven artifact <b>{analysis.maven.artifact}</b> · Java {analysis.maven.java_release ?? '?'}
            </p>
          )}
          {analysis.package_json && Object.keys(analysis.package_json.test_libraries).length > 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              package.json: {Object.entries(analysis.package_json.test_libraries).map(([k, v]) => `${k} ${v}`).join(', ')}
            </p>
          )}
        </Card>

        <Card title="How tests run here" icon={<PlayCircle size={15} />}>
          {analysis.runnable.length === 0 && !analysis.appium && analysis.bruno_collections.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">No runnable test framework was detected yet. Ask the assistant to set one up.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {analysis.appium && <li className="text-gray-700 dark:text-gray-200"><b>Appium</b> device runs (Cucumber runners / TestNG suites)</li>}
              {analysis.bruno_collections.length > 0 && (
                <li className="text-gray-700 dark:text-gray-200"><b>Bruno</b> · {analysis.bruno_collections.length} collections</li>
              )}
              {analysis.runnable.map(runner => (
                <li key={`${runner.name}-${runner.root}`} className="text-gray-700 dark:text-gray-200">
                  <b>{runner.name}</b>{runner.root !== '.' && <span className="text-gray-400"> ({runner.root})</span>} · {runner.runner} · {runner.targets} runnable targets
                  {runner.missing_tools.length > 0 && (
                    <span className="ml-1 inline-flex items-center gap-1 text-amber-600"><AlertTriangle size={11} /> missing {runner.missing_tools.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">Use the <b>Test</b> tab to run them after the assistant changes the project.</p>
        </Card>

        <Card title={`Tests (${analysis.test_files_count.toLocaleString()} files)`} icon={<FileCode2 size={15} />}>
          {Object.keys(analysis.test_file_kinds).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {Object.entries(analysis.test_file_kinds).map(([kind, count]) => (
                <span key={kind} className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">{kind}: <b>{count}</b></span>
              ))}
            </div>
          )}
          {testExamples.length === 0 ? (
            <p className="text-xs text-gray-400">No test files found.</p>
          ) : (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
              {testExamples.map(file => (
                <li key={file} className="truncate font-mono text-[11px] text-gray-600 dark:text-gray-300" title={file}>{file}</li>
              ))}
              {analysis.test_files_count > testExamples.length && (
                <li className="text-[11px] text-gray-400">… and {(analysis.test_files_count - testExamples.length).toLocaleString()} more</li>
              )}
            </ul>
          )}
        </Card>

        <Card title="Structure" icon={<FolderTree size={15} />}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {analysis.structure.slice(0, 16).map(item => (
              <div key={item.folder} className="flex justify-between gap-2 py-0.5 text-xs">
                <span className="truncate font-mono text-gray-700 dark:text-gray-200">{item.folder}{item.folder !== '(root)' && '/'}</span>
                <span className="text-gray-400">{item.files}</span>
              </div>
            ))}
          </div>
          {analysis.key_files.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-[11px] font-medium text-gray-500 dark:text-gray-400">Configuration the assistant reads</p>
              <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{analysis.key_files.slice(0, 12).join(' · ')}</p>
            </>
          )}
        </Card>

        {changed.length > 0 && (
          <Card title={`Uncommitted changes (${analysis.git.changed_count})`} icon={<GitBranch size={15} />} className="xl:col-span-2">
            <ul className="grid max-h-40 gap-x-4 overflow-y-auto sm:grid-cols-2">
              {changed.map(item => (
                <li key={item.path} className="flex gap-2 truncate text-xs" title={item.path}>
                  <span className="w-5 shrink-0 font-mono text-amber-600">{item.status}</span>
                  <span className="truncate font-mono text-gray-600 dark:text-gray-300">{item.path}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}
