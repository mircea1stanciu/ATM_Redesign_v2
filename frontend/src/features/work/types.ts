export type WorkSource = 'jira' | 'confluence'
export type WorkStatus = 'todo' | 'in_progress' | 'in_review' | 'done'
export type WorkKind = 'user_story' | 'technical_story' | 'requirement_page' | 'other'
export type TraceTarget = 'test_file' | 'suite' | 'run' | 'pull_request'

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
}

export const WORK_STATUSES: WorkStatus[] = ['todo', 'in_progress', 'in_review', 'done']

export const KIND_LABELS: Record<WorkKind, string> = {
  user_story: 'Story',
  technical_story: 'Technical story',
  requirement_page: 'Requirement page',
  other: 'Issue',
}

export interface TraceLink {
  id: number
  target_type: TraceTarget
  target_ref: string
  label: string | null
}

export interface WorkItem {
  id: number
  project_id: string
  source: WorkSource
  external_key: string
  kind: WorkKind
  title: string
  url: string | null
  status: WorkStatus
  assignee_id: string | null
  assignee_name: string | null
  branch: string | null
  updated_at: string | null
  context?: { title?: string; type?: string; status?: string; url?: string; text?: string } | null
  links?: TraceLink[]
  warning?: string | null
}

export interface InboxEntry {
  key: string
  title: string
  status?: string | null
  issue_type?: string
  kind: WorkKind
  assignee?: string | null
  author?: string | null
  labels?: string[]
  priority?: string | null
  updated?: string | null
  url: string
  work_item: WorkItem | null
}

export interface InboxPage {
  items: InboxEntry[]
  total?: number
  next_cursor: number | null
}

export interface JiraFilters {
  project_key: string
  issue_types: string[]
  story_types: string[]
  statuses: string[]
}

export interface IssueDetail {
  key: string
  title: string
  status: string | null
  issue_type: string
  kind: WorkKind
  assignee: string | null
  reporter: string | null
  priority: string | null
  labels: string[]
  url: string
  description_html: string
  acceptance_criteria_html: string
  links: Array<{ relation: string; key: string; title: string; status: string | null }>
  attachments: Array<{ name: string; size: number | null; mime_type: string | null }>
  comments: Array<{ author: string | null; created: string | null; body_html: string; body_text: string }>
  work_item: WorkItem | null
}

export interface PageDetail {
  key: string
  title: string
  kind: WorkKind
  url: string
  updated: string | null
  author: string | null
  body_html: string
  work_item: WorkItem | null
}

export interface Suggestions {
  has_checkout: boolean
  test_files: Array<{ path: string; score: number }>
  suites: Array<{ id: string; name: string }>
}

export interface JiraTransition {
  id: string
  name: string
  to: string | null
}
