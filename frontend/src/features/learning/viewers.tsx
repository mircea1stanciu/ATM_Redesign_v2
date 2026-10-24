import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
  GraduationCap,
  HelpCircle,
  Layers,
  Lock,
  PlayCircle,
  Target,
  Terminal,
  Wrench,
} from 'lucide-react'
import { MODULE_QUIZZES, PROGRAMS, type Lesson, type Level, type Module, type Program } from './upskillingData'

type Track = 'frameworks' | 'languages'

const TRACK_OPTIONS: Array<{ id: Track; title: string; subtitle: string }> = [
  {
    id: 'frameworks',
    title: 'Upskilling Automation Frameworks',
    subtitle: 'Bruno, Appium and framework-specific test engineering tracks',
  },
  {
    id: 'languages',
    title: 'Upskilling Programming Languages',
    subtitle: 'JavaScript, Java and Python paths focused on automation testing',
  },
]

const LEVEL_STYLES: Record<Level, string> = {
  Beginner: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  Intermediate: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  Advanced: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
}

const ACCENT_STYLES: Record<string, { active: string; icon: string; bar: string; solid: string }> = {
  orange: {
    active: 'border-orange-300 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-500/10',
    icon: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300',
    bar: 'bg-orange-500',
    solid: 'bg-orange-500 hover:bg-orange-600',
  },
  purple: {
    active: 'border-purple-300 bg-purple-50 dark:border-purple-500/40 dark:bg-purple-500/10',
    icon: 'bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
    bar: 'bg-purple-500',
    solid: 'bg-purple-500 hover:bg-purple-600',
  },
}

function getAccentStyles(accent: string) {
  return ACCENT_STYLES[accent] ?? ACCENT_STYLES.orange
}

const STORAGE_KEY = 'upskilling.completedLessons'
const QUIZ_STORAGE_KEY = 'upskilling.passedModuleQuizzes'
const QUIZ_GRADE_STORAGE_KEY = 'upskilling.moduleQuizGrades'

interface ModuleQuizGrade {
  score: number
  total: number
  passed: boolean
  attempts: number
  bestScore: number
  updatedAt: number
}

function loadCompleted(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function loadQuizPassed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(QUIZ_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function loadQuizGrades(): Record<string, ModuleQuizGrade> {
  try {
    const raw = localStorage.getItem(QUIZ_GRADE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, ModuleQuizGrade>) : {}
  } catch {
    return {}
  }
}

const COMMENT_CLASS = 'text-emerald-400/80'

type VisualKind = 'terminal' | 'editor' | 'git'
interface Visual {
  kind: VisualKind
  fileName?: string
  color?: string
}

// Pick the right "screenshot" chrome (terminal, VS Code editor or git diff)
// based on what the code sample actually contains.
function detectVisual(code: string): Visual {
  const text = code
  const firstReal = text.split('\n').map(l => l.trim()).find(Boolean) || ''

  // --- Editor: recognizable file formats ---
  if (/jobs:/.test(text) && /runs-on:/.test(text)) {
    return { kind: 'editor', fileName: '.github/workflows/ci.yml', color: 'bg-purple-400' }
  }
  if (/(^|\n)\s*(get|post|put|delete)\s*\{/.test(text) || /meta\s*\{/.test(text) || /body:json/.test(text) || /headers\s*\{/.test(text)) {
    return { kind: 'editor', fileName: 'request.bru', color: 'bg-orange-400' }
  }
  if (/API_TOKEN=/.test(text)) {
    return { kind: 'editor', fileName: '.env', color: 'bg-gray-400' }
  }
  if (/<dependency>|<project>|<groupId>|<artifactId>/.test(text)) {
    return { kind: 'editor', fileName: 'pom.xml', color: 'bg-red-400' }
  }
  if (/\b(public class|WebDriver|By\.|Assertions\.|@Test|void\s+\w+\s*\()/m.test(text)) {
    return { kind: 'editor', fileName: 'LoginTest.java', color: 'bg-red-400' }
  }
  if (/\b(def\s+\w+\(|import requests|@pytest\.|pytest|assert\s+|class\s+\w+\s*:)\b/m.test(text)) {
    return { kind: 'editor', fileName: 'test_login.py', color: 'bg-yellow-400' }
  }
  const isJs =
    /\b(import|export|const|let|await|function|class)\b/.test(text) ||
    /\.setVar\(/.test(text) ||
    /expect\(/.test(text) ||
    /\b(it|test|describe|beforeEach|afterEach)\(/.test(text) ||
    /=>/.test(text)
  if (isJs) {
    let fileName = 'example.ts'
    if (/wdio\.conf/.test(text) || /export const config/.test(text)) fileName = 'wdio.conf.js'
    else if (/\b(it|test|describe)\(/.test(text)) fileName = 'login.spec.ts'
    else if (/class \w+Page/.test(text)) fileName = 'pages.ts'
    else if (/const (caps|iosCaps|attachCaps|devices)/.test(text)) fileName = 'capabilities.ts'
    else if (/remote\(/.test(text)) fileName = 'session.ts'
    else if (/before(Each|All)\(/.test(text)) fileName = 'hooks.ts'
    else if (/bru\.setVar/.test(text)) fileName = 'script.js'
    return { kind: 'editor', fileName, color: 'bg-yellow-400' }
  }
  if ((firstReal.startsWith('[') || firstReal.startsWith('{')) && /"[a-zA-Z]/.test(text)) {
    const fileName = /platformName/.test(text)
      ? 'capabilities.json'
      : /userId/.test(text)
        ? 'data/users.json'
        : 'data.json'
    return { kind: 'editor', fileName, color: 'bg-yellow-400' }
  }

  // --- Git: commands, diffs or conflict markers ---
  if (/(^|\n)\s*git\s/.test(text) || /<<<<<<<|>>>>>>>|=======/.test(text) || /(^|\n)\s*[+-]\s/.test(text)) {
    return { kind: 'git' }
  }

  // --- Default: a plain terminal ---
  return { kind: 'terminal' }
}

function splitInlineComment(line: string): [string, string | null] {
  const m = line.match(/^(.*?)(\s(?:#|\/\/).*)$/)
  if (m && !/:\/\//.test(m[2])) return [m[1], m[2]]
  return [line, null]
}

function PlainLine({ line }: { line: string }) {
  const t = line.trimStart()
  if (t.startsWith('#') || t.startsWith('//')) return <span className={COMMENT_CLASS}>{line || ' '}</span>
  const [codePart, comment] = splitInlineComment(line)
  return (
    <>
      {codePart}
      {comment && <span className={COMMENT_CLASS}>{comment}</span>}
      {!line && ' '}
    </>
  )
}

function GitLine({ line }: { line: string }) {
  const t = line.trimStart()
  if (t.startsWith('#') || t.startsWith('//')) return <span className={COMMENT_CLASS}>{line || ' '}</span>
  if (/^(<<<<<<<|=======|>>>>>>>)/.test(t)) return <span className="text-amber-400">{line}</span>
  if (/^\+/.test(t)) return <span className="text-emerald-400">{line}</span>
  if (/^-/.test(t)) return <span className="text-rose-400">{line}</span>
  const [codePart, comment] = splitInlineComment(line)
  return (
    <>
      {codePart}
      {comment && <span className={COMMENT_CLASS}>{comment}</span>}
      {!line && ' '}
    </>
  )
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => undefined,
    )
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[10px] font-medium text-gray-200 opacity-0 transition hover:bg-white/20 group-hover:opacity-100"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function WindowDots() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
      <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/90" />
      <span className="h-2.5 w-2.5 rounded-full bg-green-400/90" />
    </div>
  )
}

function TerminalChrome({ code, git = false }: { code: string; git?: boolean }) {
  const lines = code.split('\n')
  return (
    <div className="group relative mt-3 overflow-hidden rounded-xl border border-gray-700/60 bg-gray-900 shadow-sm">
      <div className="flex items-center gap-2 border-b border-white/10 bg-gray-800/80 px-3 py-2">
        <WindowDots />
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-gray-400">
          {git ? <GitBranch size={11} /> : <Terminal size={11} />}
          {git ? 'git — bash' : 'zsh — terminal'}
        </div>
      </div>
      <CopyButton code={code} />
      <pre className="overflow-x-auto p-3.5 text-xs leading-relaxed text-gray-100">
        <code>
          {lines.map((l, i) => (
            <div key={i}>{git ? <GitLine line={l} /> : <PlainLine line={l} />}</div>
          ))}
        </code>
      </pre>
    </div>
  )
}

function EditorChrome({ code, fileName, color }: { code: string; fileName: string; color: string }) {
  const lines = code.split('\n')
  return (
    <div className="group relative mt-3 overflow-hidden rounded-xl border border-gray-700/60 bg-[#1e1e1e] shadow-sm">
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#2d2d2d] px-3 py-1.5">
        <WindowDots />
        <div className="ml-1 flex items-center gap-1.5 rounded-t-md bg-[#1e1e1e] px-2.5 py-1 text-[10px] font-medium text-gray-300">
          <span className={`h-2 w-2 rounded-sm ${color}`} />
          {fileName}
        </div>
      </div>
      <CopyButton code={code} />
      <div className="flex overflow-x-auto">
        <div className="select-none border-r border-white/5 px-2.5 py-3 text-right text-xs leading-relaxed text-gray-600">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre className="flex-1 p-3 text-xs leading-relaxed text-gray-100">
          <code>
            {lines.map((l, i) => (
              <div key={i}>
                <PlainLine line={l} />
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}

function StepVisual({ code }: { code: string }) {
  const v = detectVisual(code)
  if (v.kind === 'editor') {
    return <EditorChrome code={code} fileName={v.fileName || 'file'} color={v.color || 'bg-yellow-400'} />
  }
  if (v.kind === 'git') return <TerminalChrome code={code} git />
  return <TerminalChrome code={code} />
}

interface QuizViewProps {
  program: Program
  module: Module
  onBack: () => void
  onFinish: (result: { score: number; total: number; passed: boolean }) => void
}

function QuizView({ program, module, onBack, onFinish }: QuizViewProps) {
  const accent = getAccentStyles(program.accent)
  const questions = MODULE_QUIZZES[module.id] ?? [
    {
      type: 'theoretical',
      question: module.quiz.question,
      options: module.quiz.options,
      correctIndex: module.quiz.correctIndex,
      explanation: module.quiz.explanation,
    },
  ]
  const totalQuestions = questions.length
  const passThreshold = Math.min(7, totalQuestions)
  const theoreticalCount = questions.filter(q => q.type === 'theoretical').length
  const practicalCount = questions.filter(q => q.type === 'practical').length

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string } | null>(null)
  const advanceTimer = useRef<number | null>(null)
  const attemptSavedRef = useRef(false)

  const currentQuestion = questions[currentIndex]

  useEffect(
    () => () => {
      if (advanceTimer.current) {
        window.clearTimeout(advanceTimer.current)
      }
    },
    [],
  )

  const answerAndAdvance = (answerIndex: number) => {
    if (finished || selected !== null) return
    const correct = answerIndex === currentQuestion.correctIndex
    setSelected(answerIndex)
    setFeedback({ correct, explanation: currentQuestion.explanation })
    if (correct) {
      setScore(prev => prev + 1)
    }

    const isLast = currentIndex === totalQuestions - 1
    advanceTimer.current = window.setTimeout(() => {
      if (isLast) {
        setFinished(true)
        setSelected(null)
        return
      }
      setCurrentIndex(prev => prev + 1)
      setSelected(null)
    }, 600)
  }

  const retry = () => {
    if (advanceTimer.current) {
      window.clearTimeout(advanceTimer.current)
      advanceTimer.current = null
    }
    setCurrentIndex(0)
    setSelected(null)
    setScore(0)
    setFinished(false)
    setFeedback(null)
    attemptSavedRef.current = false
  }

  const progressValue = Math.round(((finished ? totalQuestions : currentIndex + 1) / totalQuestions) * 100)
  const passed = finished && score >= passThreshold

  useEffect(() => {
    if (!finished || attemptSavedRef.current) return
    onFinish({ score, total: totalQuestions, passed })
    attemptSavedRef.current = true
  }, [finished, onFinish, passed, score, totalQuestions])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft size={14} /> Back to {program.name} learning path
        </button>
        <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400">
          <span>{program.name}</span>
          <ChevronRight size={12} />
          <span>{module.title}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${accent.icon}`}>
            <HelpCircle size={16} />
          </div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Module Quiz</h1>
        </div>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Complete all <strong>{totalQuestions} questions</strong> in order. The next question opens automatically after each answer.
          You need at least <strong>{passThreshold}/{totalQuestions}</strong> to complete <strong>{module.title}</strong>.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-yellow-50 px-2 py-0.5 font-medium text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300">
            Theory: {theoreticalCount}
          </span>
          <span className="rounded-full bg-orange-50 px-2 py-0.5 font-medium text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
            Practical: {practicalCount}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        {!finished ? (
          <>
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-gray-500 dark:text-gray-400">
                <span>
                  Question {currentIndex + 1} / {totalQuestions}
                </span>
                <span>
                  Score: {score} / {totalQuestions}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div className={`h-full rounded-full ${accent.bar}`} style={{ width: `${progressValue}%` }} />
              </div>
            </div>

            <p className="text-sm font-semibold text-gray-900 dark:text-white">{currentQuestion.question}</p>
            <div className="mt-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  currentQuestion.type === 'practical'
                    ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'
                    : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
                }`}
              >
                {currentQuestion.type === 'practical' ? 'Practical Question' : 'Theoretical Question'}
              </span>
            </div>
            {currentQuestion.code && (
              <div className="mt-3">
                <StepVisual code={currentQuestion.code} />
              </div>
            )}

            <div className="mt-3 space-y-2">
              {currentQuestion.options.map((opt, i) => {
                const isChosen = selected === i
                const showCorrect = selected !== null && i === currentQuestion.correctIndex
                const showWrong = selected !== null && isChosen && i !== currentQuestion.correctIndex
                return (
                  <button
                    key={`${currentQuestion.question}-${i}`}
                    type="button"
                    disabled={selected !== null}
                    onClick={() => answerAndAdvance(i)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-90 ${
                      showCorrect
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
                        : showWrong
                          ? 'border-rose-400 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <div
            className={`rounded-xl border p-4 text-sm ${
              passed
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
            }`}
          >
            <p className="font-semibold">
              Final score: {score}/{totalQuestions}
            </p>
            <p className="mt-1">
              {passed
                ? `Great job. You reached the minimum ${passThreshold}/${totalQuestions} and can complete this module.`
                : `You need at least ${passThreshold}/${totalQuestions}. Review lessons and retry the quiz.`}
            </p>
          </div>
        )}

        {feedback && (
          <div
            className={`mt-4 rounded-lg border p-3 text-xs ${
              feedback.correct
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
            }`}
          >
            {feedback.correct ? 'Correct. ' : 'Incorrect. '}
            {feedback.explanation}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {finished && (
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40"
            >
              Retry 10-question quiz
            </button>
          )}
          {finished && passed && (
            <button
              type="button"
              onClick={() => {
                onBack()
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${accent.solid}`}
            >
              <CheckCircle2 size={16} /> Complete module
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface CourseViewerProps {
  program: Program
  module: Module
  lesson: Lesson
  isCompleted: boolean
  onBack: () => void
  onComplete: () => void
}

function CourseViewer({ program, module, lesson, isCompleted, onBack, onComplete }: CourseViewerProps) {
  const accent = getAccentStyles(program.accent)
  const total = lesson.steps.length
  const [current, setCurrent] = useState(0)
  const step = lesson.steps[current]
  const isLast = current === total - 1
  const stepProgress = Math.round(((current + 1) / total) * 100)

  const finish = () => {
    onComplete()
    onBack()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      {/* Course header */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft size={14} /> Back to {program.name} learning path
        </button>
        <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400">
          <span>{program.name}</span>
          <ChevronRight size={12} />
          <span>{module.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">{lesson.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${LEVEL_STYLES[lesson.level]}`}>
            {lesson.level}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <Clock size={11} /> {lesson.duration}
          </span>
          {isCompleted && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 size={11} /> Completed
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{lesson.summary}</p>

        {/* Step progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span>
              Step {current + 1} of {total}
            </span>
            <span>{stepProgress}%</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div className={`h-full rounded-full transition-all ${accent.bar}`} style={{ width: `${stepProgress}%` }} />
          </div>
        </div>
      </div>

      {/* Step navigator dots */}
      <div className="flex flex-wrap gap-2">
        {lesson.steps.map((s, i) => {
          const isActive = i === current
          const isPast = i < current
          return (
            <button
              key={s.title}
              type="button"
              onClick={() => setCurrent(i)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold transition ${
                isActive
                  ? `${accent.solid} text-white`
                  : isPast
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
              }`}
              title={s.title}
            >
              {isPast ? <Check size={13} /> : i + 1}
            </button>
          )
        })}
      </div>

      {/* Current step */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex items-start gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${accent.icon}`}>
            {current + 1}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{step.detail}</p>
            {step.code && <StepVisual code={step.code} />}
          </div>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <button
          type="button"
          onClick={() => setCurrent(c => Math.max(0, c - 1))}
          disabled={current === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40"
        >
          <ArrowLeft size={15} /> Previous
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={finish}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${accent.solid}`}
          >
            <CheckCircle2 size={16} /> {isCompleted ? 'Finish & keep completed' : 'Finish & mark complete'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCurrent(c => Math.min(total - 1, c + 1))}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${accent.solid}`}
          >
            Next <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function UpskillingPage() {
  const [activeTrack, setActiveTrack] = useState<Track>('frameworks')
  const [activeId, setActiveId] = useState<string>(PROGRAMS.find(p => p.track === 'frameworks')?.id || PROGRAMS[0].id)
  const [completed, setCompleted] = useState<Record<string, boolean>>(() => loadCompleted())
  const [quizPassed, setQuizPassed] = useState<Record<string, boolean>>(() => loadQuizPassed())
  const [quizGrades, setQuizGrades] = useState<Record<string, ModuleQuizGrade>>(() => loadQuizGrades())
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({})
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null)
  const [quizModuleId, setQuizModuleId] = useState<string | null>(null)

  const trackPrograms = useMemo(() => PROGRAMS.filter(p => p.track === activeTrack), [activeTrack])
  const fallbackProgram = trackPrograms[0] ?? PROGRAMS[0]
  const program = trackPrograms.find(p => p.id === activeId) ?? fallbackProgram
  const accent = getAccentStyles(program.accent)

  useEffect(() => {
    if (!trackPrograms.some(p => p.id === activeId)) {
      setActiveId(fallbackProgram.id)
      setActiveLessonId(null)
    }
  }, [activeId, fallbackProgram.id, trackPrograms])

  useEffect(() => {
    const firstModuleId = program.modules[0]?.id
    if (!firstModuleId) return
    if (!Object.keys(openModules).length) {
      setOpenModules({ [firstModuleId]: true })
    }
  }, [program, openModules])

  const allLessonIds = useMemo(
    () => program.modules.flatMap(m => m.lessons.map(l => l.id)),
    [program],
  )
  const doneCount = allLessonIds.filter(id => completed[id]).length
  const totalLessons = allLessonIds.length
  const progress = totalLessons ? Math.round((doneCount / totalLessons) * 100) : 0
  const totalMinutes = useMemo(
    () =>
      program.modules.reduce(
        (sum, m) => sum + m.lessons.reduce((s, l) => s + (parseInt(l.duration, 10) || 0), 0),
        0,
      ),
    [program],
  )

  const setLessonComplete = (id: string, value: boolean) => {
    setCompleted(prev => {
      const next = { ...prev, [id]: value }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore persistence errors */
      }
      return next
    })
  }

  const toggleLesson = (id: string) => setLessonComplete(id, !completed[id])
  const toggleModule = (id: string) => setOpenModules(prev => ({ ...prev, [id]: !prev[id] }))

  const setModuleQuizPassed = (id: string, value: boolean) => {
    setQuizPassed(prev => {
      const next = { ...prev, [id]: value }
      try {
        localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore persistence errors */
      }
      return next
    })
  }

  const setModuleQuizResult = (id: string, score: number, total: number, passed: boolean) => {
    setQuizGrades(prev => {
      const current = prev[id]
      const nextGrade: ModuleQuizGrade = {
        score,
        total,
        passed,
        attempts: (current?.attempts ?? 0) + 1,
        bestScore: Math.max(current?.bestScore ?? 0, score),
        updatedAt: Date.now(),
      }
      const next = { ...prev, [id]: nextGrade }
      try {
        localStorage.setItem(QUIZ_GRADE_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore persistence errors */
      }
      return next
    })
    setModuleQuizPassed(id, passed)
  }

  const hasPassedModuleQuiz = (moduleId: string) => quizGrades[moduleId]?.passed ?? !!quizPassed[moduleId]

  // Modules unlock gradually: the first module is always open, and each
  // following module unlocks only once the previous module's quiz is passed.
  const isModuleUnlocked = (modIndex: number) =>
    modIndex === 0 || hasPassedModuleQuiz(program.modules[modIndex - 1].id)
  const isModuleLessonsComplete = (mod: Module) => mod.lessons.every(l => !!completed[l.id])

  const moduleCountWithQuiz = program.modules.length
  const attemptedQuizCount = program.modules.filter(m => !!quizGrades[m.id]).length
  const passedQuizCount = program.modules.filter(m => hasPassedModuleQuiz(m.id)).length
  const averageBestQuizPercent = (() => {
    const grades = program.modules.map(m => quizGrades[m.id]).filter(Boolean) as ModuleQuizGrade[]
    if (!grades.length) return 0
    const sum = grades.reduce((acc, g) => acc + Math.round((g.bestScore / g.total) * 100), 0)
    return Math.round(sum / grades.length)
  })()

  // Module quiz view
  if (quizModuleId) {
    const quizModule = program.modules.find(m => m.id === quizModuleId)
    if (quizModule) {
      return (
        <QuizView
          program={program}
          module={quizModule}
          onBack={() => setQuizModuleId(null)}
          onFinish={({ score, total, passed }) => setModuleQuizResult(quizModule.id, score, total, passed)}
        />
      )
    }
  }

  // Step-by-step course view
  if (activeLessonId) {
    for (const mod of program.modules) {
      const lesson = mod.lessons.find(l => l.id === activeLessonId)
      if (lesson) {
        return (
          <CourseViewer
            program={program}
            module={mod}
            lesson={lesson}
            isCompleted={!!completed[lesson.id]}
            onBack={() => setActiveLessonId(null)}
            onComplete={() => setLessonComplete(lesson.id, true)}
          />
        )
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-50 dark:bg-yellow-500/10">
            <GraduationCap size={22} className="text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              {activeTrack === 'frameworks' ? 'Upskilling · Automation Frameworks' : 'Upskilling · Programming Languages'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeTrack === 'frameworks'
                ? 'Structured, hands-on learning paths for automation frameworks.'
                : 'Structured, hands-on language courses built for automation testing.'}
            </p>
          </div>
        </div>
      </div>

      {/* Track selector */}
      <div className="grid gap-3 md:grid-cols-2">
        {TRACK_OPTIONS.map(t => {
          const isActive = t.id === activeTrack
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTrack(t.id)
                setActiveLessonId(null)
                setOpenModules({})
              }}
              className={`rounded-2xl border p-4 text-left transition ${
                isActive
                  ? 'border-yellow-300 bg-yellow-50 dark:border-yellow-500/40 dark:bg-yellow-500/10'
                  : 'border-gray-200/80 bg-white hover:border-gray-300 dark:border-gray-700/70 dark:bg-gray-800/90 dark:hover:border-gray-600'
              }`}
            >
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t.title}</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.subtitle}</p>
            </button>
          )
        })}
      </div>

      {/* Program selector */}
      <div className="grid gap-3 sm:grid-cols-2">
        {trackPrograms.map(p => {
          const Icon = p.icon
          const pAccent = getAccentStyles(p.accent)
          const isActive = p.id === activeId
          const pLessons = p.modules.flatMap(m => m.lessons.map(l => l.id))
          const pDone = pLessons.filter(id => completed[id]).length
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setActiveId(p.id)
                setActiveLessonId(null)
                const firstModuleId = p.modules[0]?.id
                setOpenModules(firstModuleId ? { [firstModuleId]: true } : {})
              }}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                isActive
                  ? pAccent.active
                  : 'border-gray-200/80 bg-white hover:border-gray-300 dark:border-gray-700/70 dark:bg-gray-800/90 dark:hover:border-gray-600'
              }`}
            >
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${pAccent.icon}`}>
                <Icon size={22} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{p.name}</h3>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {p.category}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{p.tagline}</p>
                <p className="mt-2 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                  {pDone}/{pLessons.length} lessons completed
                </p>
                <p className="mt-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                  {p.modules.filter(m => !!quizGrades[m.id]).length}/{p.modules.length} quizzes attempted
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Program overview */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-gray-400" />
            <h2 className="text-base font-bold text-gray-900 dark:text-white">{program.name} Learning Path</h2>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <Layers size={14} /> {program.modules.length} modules
            </span>
            <span className="flex items-center gap-1">
              <BookOpen size={14} /> {totalLessons} lessons
            </span>
            <span className="flex items-center gap-1">
              <HelpCircle size={14} /> {moduleCountWithQuiz} quizzes
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} /> ~{Math.round((totalMinutes / 60) * 10) / 10}h
            </span>
          </div>
        </div>

        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{program.overview}</p>
        <div className="mt-3 rounded-xl border border-yellow-100 bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300">
          <span className="font-semibold">Quiz &amp; Grades:</span> {attemptedQuizCount}/{moduleCountWithQuiz} quizzes attempted,
          {` `}{passedQuizCount}/{moduleCountWithQuiz} passed, average best grade {averageBestQuizPercent}%.
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span>Your progress</span>
            <span>
              {doneCount}/{totalLessons} · {progress}%
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div className={`h-full rounded-full transition-all ${accent.bar}`} style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Prereqs & outcomes */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-700/30">
            <div className="mb-2 flex items-center gap-2">
              <Wrench size={14} className="text-gray-400" />
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">Prerequisites</h3>
            </div>
            <ul className="space-y-1.5">
              {program.prerequisites.map(item => (
                <li key={item} className="flex gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <Circle size={6} className="mt-1.5 shrink-0 fill-current text-gray-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-700/30">
            <div className="mb-2 flex items-center gap-2">
              <Target size={14} className="text-gray-400" />
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">What you&apos;ll be able to do</h3>
            </div>
            <ul className="space-y-1.5">
              {program.outcomes.map(item => (
                <li key={item} className="flex gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Modules & lessons */}
      <div className="space-y-3">
        {program.modules.map((mod, modIndex) => {
          const modLessonIds = mod.lessons.map(l => l.id)
          const modDone = modLessonIds.filter(id => completed[id]).length
          const unlocked = isModuleUnlocked(modIndex)
          const passed = hasPassedModuleQuiz(mod.id)
          const grade = quizGrades[mod.id]
          const lessonsComplete = isModuleLessonsComplete(mod)
          const isOpen = unlocked && (openModules[mod.id] ?? false)
          return (
            <div
              key={mod.id}
              className={`overflow-hidden rounded-2xl border shadow-soft transition ${
                unlocked
                  ? 'border-gray-200/80 bg-white dark:border-gray-700/70 dark:bg-gray-800/90'
                  : 'border-gray-200/60 bg-gray-50/60 dark:border-gray-700/50 dark:bg-gray-800/40'
              }`}
            >
              <button
                type="button"
                onClick={() => unlocked && toggleModule(mod.id)}
                disabled={!unlocked}
                className={`flex w-full items-center gap-3 p-4 text-left transition ${
                  unlocked ? 'hover:bg-gray-50 dark:hover:bg-gray-700/30' : 'cursor-not-allowed opacity-70'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                    unlocked ? accent.icon : 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                  }`}
                >
                  {unlocked ? modIndex + 1 : <Lock size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{mod.title}</h3>
                    {passed && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <Award size={11} /> Passed
                      </span>
                    )}
                    {grade && (
                      <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300">
                        Grade {grade.score}/{grade.total} · Best {grade.bestScore}/{grade.total}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                    {unlocked ? mod.description : 'Locked — complete the previous module\'s quiz to unlock'}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {modDone}/{mod.lessons.length}
                </span>
                {unlocked && (
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                )}
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 dark:border-gray-700/70">
                  {mod.lessons.map(lesson => {
                    const isDone = !!completed[lesson.id]
                    return (
                      <div
                        key={lesson.id}
                        className="border-b border-gray-100 p-4 last:border-b-0 dark:border-gray-700/50"
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => toggleLesson(lesson.id)}
                            className="mt-0.5 shrink-0"
                            aria-label={isDone ? 'Mark as not completed' : 'Mark as completed'}
                          >
                            {isDone ? (
                              <CheckCircle2 size={20} className="text-emerald-500" />
                            ) : (
                              <Circle size={20} className="text-gray-300 transition hover:text-gray-400 dark:text-gray-600" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4
                                className={`text-sm font-semibold ${
                                  isDone
                                    ? 'text-gray-400 line-through dark:text-gray-500'
                                    : 'text-gray-900 dark:text-white'
                                }`}
                              >
                                {lesson.title}
                              </h4>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${LEVEL_STYLES[lesson.level]}`}>
                                {lesson.level}
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                                <Clock size={11} /> {lesson.duration}
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                                <Layers size={11} /> {lesson.steps.length} steps
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{lesson.summary}</p>

                            <div className="mt-2.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Objectives</p>
                              <ul className="mt-1 space-y-1">
                                {lesson.objectives.map(obj => (
                                  <li key={obj} className="flex gap-2 text-xs text-gray-600 dark:text-gray-300">
                                    <Circle size={5} className="mt-1.5 shrink-0 fill-current text-gray-400" />
                                    {obj}
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div className="mt-2.5 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-700/20">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-yellow-500 dark:text-yellow-400">
                                Hands-on
                              </p>
                              <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{lesson.practice}</p>
                            </div>

                            <button
                              type="button"
                              onClick={() => setActiveLessonId(lesson.id)}
                              className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition ${accent.solid}`}
                            >
                              <PlayCircle size={15} />
                              {isDone ? 'Review step-by-step course' : 'Start step-by-step course'}
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Module quiz gate: appears once every lesson is complete */}
                  {lessonsComplete && (
                    <div className="border-t border-dashed border-gray-200 p-4 dark:border-gray-700">
                      <div
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${
                          passed
                            ? 'border border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                            : 'border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
                        }`}
                      >
                        <div className={`flex flex-col gap-1 text-xs ${passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                          <div className="flex items-center gap-2 font-medium">
                            {passed ? <Award size={15} /> : <HelpCircle size={15} />}
                            {passed
                              ? 'Module quiz passed — next module unlocked.'
                              : 'All lessons complete — finish all 10 quiz questions and score at least 7/10 to unlock the next module.'}
                          </div>
                          {grade && (
                            <div>
                              Latest grade: {grade.score}/{grade.total} ({Math.round((grade.score / grade.total) * 100)}%) · Best:{' '}
                              {grade.bestScore}/{grade.total} ({Math.round((grade.bestScore / grade.total) * 100)}%) · Attempts: {grade.attempts}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setQuizModuleId(mod.id)}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition ${accent.solid}`}
                        >
                          <HelpCircle size={14} /> {grade ? 'Retry quiz' : 'Take 10-question quiz'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Resources */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
        <div className="mb-3 flex items-center gap-2">
          <ExternalLink size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Reference &amp; Documentation</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {program.resources.map(res => (
            <a
              key={res.url}
              href={res.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-700 transition hover:border-yellow-300 hover:text-yellow-600 dark:border-gray-700 dark:bg-gray-700/30 dark:text-gray-300 dark:hover:border-yellow-500/50 dark:hover:text-yellow-400"
            >
              <span className="truncate">{res.label}</span>
              <ExternalLink size={14} className="shrink-0" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
