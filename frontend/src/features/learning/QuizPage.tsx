import { useCallback } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState, Skeleton } from '@/ui'
import { findModule } from './paths'
import { backToPath } from './LessonPage'
import { useMyLearning } from './useMyLearning'
import { QuizView } from './viewers'

/** Learning › a module quiz: shuffled questions and options; every attempt is saved (best score, passed). */
export default function QuizPage() {
  const { moduleId = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { me, recordQuiz } = useMyLearning()
  const found = findModule(moduleId)
  const { mutate } = recordQuiz
  const onFinish = useCallback(({ score, total }: { score: number; total: number }) => mutate({ moduleId, score, total }), [moduleId, mutate])
  if (!found) return <EmptyState title="Quiz not found"><Link to="/learning/paths" className="text-accent hover:underline">All paths</Link></EmptyState>
  if (me.isPending) return <Skeleton className="h-64" />
  const back = backToPath(found.program, params.get('path'), me.data?.profile.path_id)
  return <QuizView program={found.program} module={found.module} onBack={() => navigate(back)} onFinish={onFinish} />
}
