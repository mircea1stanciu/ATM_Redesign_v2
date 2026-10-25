import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { apiService } from '@/services/api'
import { Checkbox, Input, Skeleton } from '@/ui'
import { reviewKeys, reviewsApi } from './api'

export interface ReviewerChoice {
  people: string[]
  teams: string[]
}

export const NO_REVIEWERS: ReviewerChoice = { people: [], teams: [] }

const toggle = (list: string[], value: string, on: boolean) => on ? [...list, value] : list.filter(item => item !== value)

/** Reviewers of a pull request, chosen among the repository's collaborators and the organisation's teams on GitHub. */
export default function ReviewerPicker({ projectId, value, onChange, exclude = [] }: {
  projectId: string
  value: ReviewerChoice
  onChange: (next: ReviewerChoice) => void
  /** Already requested: not offered again. */
  exclude?: string[]
}) {
  const [filter, setFilter] = useState('')
  const options = useQuery({ queryKey: reviewKeys.reviewerOptions(projectId), queryFn: () => reviewsApi.reviewerOptions(projectId), staleTime: 60_000 })
  if (options.isPending) return <Skeleton className="h-16" />
  if (options.isError) return <p className="text-xs text-danger">Could not load the reviewers from GitHub: {apiService.errorMessage(options.error)}</p>
  const text = filter.trim().toLowerCase()
  const people = options.data.people.filter(p => !exclude.includes(p.login) && p.login.toLowerCase().includes(text))
  const teams = options.data.teams.filter(t => !exclude.includes(t.slug) && t.name.toLowerCase().includes(text))
  const total = options.data.people.length + options.data.teams.length
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-muted"><Users size={13} aria-hidden />Reviewers on GitHub (optional)</legend>
      {total > 8 && <Input label="Find a reviewer" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Name or team" />}
      {options.data.people_error && <p className="text-xs text-fg-muted">People are not listed: {options.data.people_error}</p>}
      {total === 0 && !options.data.people_error && <p className="text-xs text-fg-muted">Nobody else has access to this repository on GitHub.</p>}
      <div className="max-h-48 space-y-1.5 overflow-y-auto">
        {people.map(person => (
          <Checkbox key={person.login} label={person.login} checked={value.people.includes(person.login)}
            onChange={e => onChange({ ...value, people: toggle(value.people, person.login, e.target.checked) })} />
        ))}
        {teams.map(team => (
          <Checkbox key={team.slug} label={<>{team.name} <span className="text-xs text-fg-muted">(team)</span></>} checked={value.teams.includes(team.slug)}
            onChange={e => onChange({ ...value, teams: toggle(value.teams, team.slug, e.target.checked) })} />
        ))}
      </div>
    </fieldset>
  )
}
