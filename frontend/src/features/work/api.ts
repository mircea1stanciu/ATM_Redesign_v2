import { api } from '@/services/api'
import type {
  InboxPage, IssueDetail, JiraFilters, JiraTransition, PageDetail, Suggestions, TraceTarget, WorkItem, WorkSource,
  WorkStatus,
} from './types'

export interface JiraInboxFilters {
  q?: string
  status?: string
  type?: string
  assignee?: '' | 'me' | 'unassigned'
  sprint?: '' | 'current'
  label?: string
}

export interface StartWorkRequest {
  source: WorkSource
  external_key: string
  start?: boolean
  branch?: string
  tests?: Array<{ type: 'test_file' | 'suite'; ref: string; label?: string }>
  comment_in_jira?: boolean
  assignee_id?: number
}

const base = (projectId: string) => `/projects/${projectId}/work`

/** The Work area's API (backend app/modules/work/router.py). */
export const workApi = {
  async jiraFilters(projectId: string): Promise<JiraFilters> {
    return (await api.get(`${base(projectId)}/jira/filters`)).data
  },
  async jiraIssues(projectId: string, filters: JiraInboxFilters, cursor = 0): Promise<InboxPage> {
    return (await api.get(`${base(projectId)}/jira/issues`, { params: { ...filters, cursor } })).data
  },
  async jiraIssue(projectId: string, key: string): Promise<IssueDetail> {
    return (await api.get(`${base(projectId)}/jira/issues/${encodeURIComponent(key)}`)).data
  },
  async confluencePages(projectId: string, q: string, cursor = 0): Promise<InboxPage> {
    return (await api.get(`${base(projectId)}/confluence/pages`, { params: { q, cursor } })).data
  },
  async confluencePage(projectId: string, pageId: string): Promise<PageDetail> {
    return (await api.get(`${base(projectId)}/confluence/pages/${encodeURIComponent(pageId)}`)).data
  },
  async suggestions(projectId: string, key: string, title: string): Promise<Suggestions> {
    return (await api.get(`${base(projectId)}/suggestions`, { params: { key, title } })).data
  },
  async items(projectId: string): Promise<WorkItem[]> {
    return (await api.get(`${base(projectId)}/items`)).data.items
  },
  async item(projectId: string, itemId: number): Promise<WorkItem> {
    return (await api.get(`${base(projectId)}/items/${itemId}`)).data
  },
  async startWork(projectId: string, request: StartWorkRequest): Promise<WorkItem> {
    return (await api.post(`${base(projectId)}/items`, request)).data
  },
  async updateItem(projectId: string, itemId: number, data: { status?: WorkStatus; assignee_id?: number | null }): Promise<WorkItem> {
    return (await api.patch(`${base(projectId)}/items/${itemId}`, data)).data
  },
  async deleteItem(projectId: string, itemId: number): Promise<void> {
    await api.delete(`${base(projectId)}/items/${itemId}`)
  },
  async addLink(projectId: string, itemId: number, link: { target_type: TraceTarget; target_ref: string; label?: string }): Promise<WorkItem> {
    return (await api.post(`${base(projectId)}/items/${itemId}/links`, link)).data
  },
  async removeLink(projectId: string, itemId: number, linkId: number): Promise<WorkItem> {
    return (await api.delete(`${base(projectId)}/items/${itemId}/links/${linkId}`)).data
  },
  async transitions(projectId: string, itemId: number): Promise<JiraTransition[]> {
    return (await api.get(`${base(projectId)}/items/${itemId}/jira/transitions`)).data.transitions
  },
  async transition(projectId: string, itemId: number, transitionId: string): Promise<void> {
    await api.post(`${base(projectId)}/items/${itemId}/jira/transition`, { transition_id: transitionId })
  },
  async comment(projectId: string, itemId: number, body: string): Promise<void> {
    await api.post(`${base(projectId)}/items/${itemId}/jira/comment`, { body })
  },
  async remoteLink(projectId: string, itemId: number, url: string, title: string): Promise<void> {
    await api.post(`${base(projectId)}/items/${itemId}/jira/link`, { url, title })
  },
}

export const workKeys = {
  all: (projectId: string) => ['work', projectId] as const,
  items: (projectId: string) => ['work', projectId, 'items'] as const,
  item: (projectId: string, itemId: number) => ['work', projectId, 'items', itemId] as const,
  jiraFilters: (projectId: string) => ['work', projectId, 'jira-filters'] as const,
  jiraIssues: (projectId: string, filters: JiraInboxFilters) => ['work', projectId, 'jira', filters] as const,
  jiraIssue: (projectId: string, key: string) => ['work', projectId, 'jira-issue', key] as const,
  confluencePages: (projectId: string, q: string) => ['work', projectId, 'confluence', q] as const,
  confluencePage: (projectId: string, id: string) => ['work', projectId, 'confluence-page', id] as const,
  suggestions: (projectId: string, key: string) => ['work', projectId, 'suggestions', key] as const,
}
