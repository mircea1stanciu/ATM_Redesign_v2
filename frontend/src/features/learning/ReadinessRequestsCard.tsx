import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Award } from 'lucide-react'
import { Card, EmptyState, Skeleton } from '@/ui'
import { learningApi, learningKeys } from './api'

/** Home (Lead): open readiness requests of my people. */
export default function ReadinessRequestsCard() {
  const requests = useQuery({ queryKey: learningKeys.requests, queryFn: learningApi.openRequests })
  if (requests.isPending) return <Skeleton className="h-20" />
  if (!requests.data?.length) {
    return (
      <EmptyState icon={Award} title="No readiness requests"
        action={<Link to="/learning/mentor" className="text-xs font-semibold text-accent hover:underline">Mentor view</Link>}>
        Your trainees' lessons, quizzes and practice are in Learning › Mentor.
      </EmptyState>
    )
  }
  return (
    <Card>
      <ul className="divide-y divide-line" aria-label="Readiness requests">
        {requests.data.map(r => (
          <li key={r.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
            <Award size={14} className="text-accent" aria-hidden />
            <Link to={`/learning/readiness/${r.user_id}`} className="flex-1 font-semibold text-fg hover:text-accent hover:underline">{r.user}</Link>
            <span className="text-xs text-fg-muted">{new Date(`${r.requested_at}Z`).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
