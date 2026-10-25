import { api } from '@/services/api'

export interface PullSummary {
  project_id: number
  project: string
  number: number
  title: string
  author: string
  head: string
  base: string
  url: string | null
  draft: boolean
  created_at: string | null
  updated_at: string | null
  requested_reviewers: string[]
  waiting_for_me: boolean
}

export type Side = 'LEFT' | 'RIGHT'

export interface LineComment {
  id: number
  path: string
  line: number | null
  side: Side
  start_line: number | null
  body: string
  author: string
  created_at: string | null
  in_reply_to_id: number | null
  outdated: boolean
}

export interface PullFile {
  filename: string
  previous_filename: string | null
  status: string
  additions: number
  deletions: number
  patch: string | null
}

export interface PullDetail {
  project_id: number
  project: string
  number: number
  title: string
  body: string
  state: string
  draft: boolean
  url: string | null
  author: string
  head: string
  base: string
  head_sha: string | null
  created_at: string | null
  requested_reviewers: string[]
  requested_teams: string[]
  files: PullFile[]
  comments: LineComment[]
  conversation: { kind: 'comment' | 'review'; id: number; author: string; body: string; state: string | null; created_at: string | null }[]
  checks: { name: string; status: string; conclusion: string | null; url: string | null }[]
  runs: { id: string; name: string; suite: string; status: string; passed: number; failed: number; created_at: string | null; report: boolean }[]
  work_item: { key: string; title: string; url: string | null; status: string } | null
  me: { login: string; is_author: boolean; can_comment: boolean; can_review: boolean; can_request_reviewers: boolean }
}

/** A comment on a line of the diff, posted to GitHub at once. */
export interface NewLineComment {
  path: string
  line: number
  side: Side
  body: string
  suggested_by_ai?: boolean
}

/** Whom a pull request can ask for a review on GitHub. */
export interface ReviewerOptions {
  people: { login: string; avatar_url: string | null }[]
  teams: { slug: string; name: string }[]
  me: string
  people_error: string | null
}

export interface Suggestion {
  path: string
  line: number
  side: Side
  body: string
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

/** The Reviews area (backend app/modules/reviews/router.py). */
export const reviewsApi = {
  async pulls(scope: 'mine' | 'all'): Promise<{ items: PullSummary[]; missing_token: string[]; errors: { project: string; detail: string }[] }> {
    return (await api.get('/reviews/pulls', { params: { scope } })).data
  },
  async pull(projectId: string, number: string): Promise<PullDetail> {
    return (await api.get(`/reviews/projects/${projectId}/pulls/${number}`)).data
  },
  async comment(projectId: string, number: string, body: string): Promise<void> {
    await api.post(`/reviews/projects/${projectId}/pulls/${number}/comments`, { body })
  },
  async lineComment(projectId: string, number: string, comment: NewLineComment): Promise<LineComment> {
    return (await api.post(`/reviews/projects/${projectId}/pulls/${number}/line-comments`, comment)).data
  },
  async review(projectId: string, number: string, event: ReviewEvent, body: string): Promise<void> {
    await api.post(`/reviews/projects/${projectId}/pulls/${number}/reviews`, { event, body })
  },
  async reviewerOptions(projectId: string): Promise<ReviewerOptions> {
    return (await api.get(`/reviews/projects/${projectId}/reviewer-options`)).data
  },
  async requestReviewers(projectId: string, number: string, reviewers: string[], teamReviewers: string[]): Promise<{ requested_reviewers: string[]; requested_teams: string[] }> {
    return (await api.post(`/reviews/projects/${projectId}/pulls/${number}/requested-reviewers`, { reviewers, team_reviewers: teamReviewers })).data
  },
  async aiReview(projectId: string, number: string): Promise<{ suggestions: Suggestion[]; dropped: number }> {
    return (await api.post(`/reviews/projects/${projectId}/pulls/${number}/ai-review`)).data
  },
}

export const reviewKeys = {
  pulls: (scope: string) => ['reviews', 'pulls', scope] as const,
  pull: (projectId: string, number: string) => ['reviews', 'pull', projectId, number] as const,
  reviewerOptions: (projectId: string) => ['reviews', 'reviewer-options', projectId] as const,
}
