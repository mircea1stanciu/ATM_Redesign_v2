import { api } from '@/services/api'

export interface QuestionSummary {
  id: number
  title: string
  tags: string[]
  author: string | null
  author_id: number | null
  pinned: boolean
  locked: boolean
  answers: number
  likes: number
  liked: boolean
  created_at: string
  updated_at: string
  can_edit: boolean
}

export interface Answer {
  id: number
  body: string
  author: string | null
  author_id: number | null
  parent_id: number | null
  likes: number
  liked: boolean
  created_at: string
  can_delete: boolean
}

export interface Question extends QuestionSummary {
  body: string
  answers_list: Answer[]
  can_moderate: boolean
}

export interface QuestionInput { title: string; body: string; tags: string[] }

/** Community (backend app/modules/learning/community_router.py, phase 21). */
export const communityApi = {
  async list(params: { q?: string; tag?: string }): Promise<{ items: QuestionSummary[]; tags: string[]; can_moderate: boolean }> {
    return (await api.get('/community/posts', { params })).data
  },
  async get(id: string | number): Promise<Question> {
    return (await api.get(`/community/posts/${id}`)).data
  },
  async ask(question: QuestionInput): Promise<Question> {
    return (await api.post('/community/posts', question)).data
  },
  async edit(id: number, question: QuestionInput): Promise<Question> {
    return (await api.put(`/community/posts/${id}`, question)).data
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/community/posts/${id}`)
  },
  async moderate(id: number, changes: { pinned?: boolean; locked?: boolean }): Promise<Question> {
    return (await api.post(`/community/posts/${id}/moderate`, changes)).data
  },
  async answer(id: number, body: string): Promise<Question> {
    return (await api.post(`/community/posts/${id}/answers`, { body })).data
  },
  async removeAnswer(id: number): Promise<void> {
    await api.delete(`/community/answers/${id}`)
  },
  async likeQuestion(id: number): Promise<{ liked: boolean; likes: number }> {
    return (await api.post(`/community/posts/${id}/like`)).data
  },
  async likeAnswer(id: number): Promise<{ liked: boolean; likes: number }> {
    return (await api.post(`/community/answers/${id}/like`)).data
  },
}

export const communityKeys = {
  all: ['community'] as const,
  list: (q: string, tag: string) => ['community', 'list', q, tag] as const,
  question: (id: string) => ['community', 'question', id] as const,
}

export function parseTags(text: string): string[] {
  return text.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5)
}
