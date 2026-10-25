import { api } from '@/services/api'
import type { LearningPath } from './paths'

export interface QuizProgress { best_score: number | null; total: number | null; attempts: number; passed: boolean; passed_at: string | null }

export interface Progress {
  lessons: Record<string, string | null>
  quizzes: Record<string, QuizProgress>
  last_activity: string | null
}

export interface MyLearning {
  profile: { path_id: string | null; tutor_mode: boolean; mentor: string | null }
  progress: Progress
}

export interface Submission {
  id: number
  task_id: number
  branch: string | null
  link: string | null
  note: string | null
  status: 'submitted' | 'approved' | 'changes_requested'
  feedback: string | null
  reviewer: string | null
  submitted_at: string
  reviewed_at: string | null
}

export interface PracticeTask {
  id: number
  title: string
  description: string
  path_id: string | null
  project: { id: number; name: string } | null
  active: boolean
  created_at: string
  my_submission: Submission | null
}

export interface Mentee extends Progress {
  id: number
  name: string
  role: string
  path_id: string | null
  mentor: string | null
  practice: { submitted: number; approved: number; changes_requested: number }
}

/** A lead's Trainees and Users with their Senior mentor, and the Seniors who can mentor (phase 21). */
export interface Mentors {
  people: { id: number; name: string; role: string; mentor_id: number | null }[]
  seniors: { id: number; name: string }[]
}

export interface PathInput { title: string; description: string; programs: string[] }

export interface WaitingPractice extends Submission { learner: string; learner_id: number; task: string; task_description: string }

export interface ReadinessRequest {
  id: number
  user_id: number
  user: string | null
  requested_by: string | null
  note: string | null
  status: 'open' | 'decided'
  decision: 'promoted' | 'not_yet' | null
  from_role: string | null
  to_role: string | null
  decision_note: string | null
  decided_by: string | null
  requested_at: string
  decided_at: string | null
}

export interface Readiness {
  user: { id: number; name: string; role: string }
  evidence: Progress & {
    path_id: string | null
    practice: { approved: number; submitted: number; changes_requested: number }
    work_items: { done: number; in_review: number; in_progress: number; todo: number }
    pull_requests: { opened: number; approved: number }
    runs: { total: number; passed: number; failed: number; last_at: string | null }
  }
  open_request: ReadinessRequest | null
  history: ReadinessRequest[]
  can_request: boolean
  promote_to: string[]
}

export interface Hint { id: string; title: string; text: string; details: string; topics: string[]; updated_at: string }

/** The Learning area (backend app/modules/learning/router.py). */
export const learningApi = {
  async me(): Promise<MyLearning> {
    return (await api.get('/learning/me')).data
  },
  async updateProfile(changes: { path_id?: string | null; tutor_mode?: boolean }): Promise<MyLearning> {
    return (await api.put('/learning/me/profile', changes)).data
  },
  async completeLesson(lessonId: string): Promise<MyLearning> {
    return (await api.put(`/learning/me/lessons/${lessonId}`)).data
  },
  async reopenLesson(lessonId: string): Promise<MyLearning> {
    return (await api.delete(`/learning/me/lessons/${lessonId}`)).data
  },
  async recordQuiz(moduleId: string, score: number, total: number): Promise<MyLearning & { passed: boolean }> {
    return (await api.post(`/learning/me/quizzes/${moduleId}`, { score, total })).data
  },
  async practice(): Promise<PracticeTask[]> {
    return (await api.get('/learning/practice')).data
  },
  async saveTask(task: { title: string; description: string; path_id: string | null; project_id: number | null; active: boolean }, id?: number): Promise<PracticeTask> {
    return (id ? await api.put(`/learning/practice/${id}`, task) : await api.post('/learning/practice', task)).data
  },
  async submit(taskId: number, work: { branch: string; link: string; note: string }): Promise<PracticeTask> {
    return (await api.post(`/learning/practice/${taskId}/submit`, work)).data
  },
  async review(submissionId: number, decision: 'approved' | 'changes_requested', feedback: string): Promise<Submission> {
    return (await api.post(`/learning/practice/submissions/${submissionId}/review`, { decision, feedback })).data
  },
  async mentor(): Promise<{ people: Mentee[]; waiting: WaitingPractice[] }> {
    return (await api.get('/learning/mentor')).data
  },
  async paths(): Promise<LearningPath[]> {
    return (await api.get('/learning/paths')).data
  },
  async savePath(path: PathInput, id?: string): Promise<LearningPath> {
    return (id ? await api.put(`/learning/paths/${id}`, path) : await api.post('/learning/paths', path)).data
  },
  async deletePath(id: string): Promise<void> {
    await api.delete(`/learning/paths/${id}`)
  },
  async reorderPaths(ids: string[]): Promise<LearningPath[]> {
    return (await api.post('/learning/paths/reorder', { ids })).data
  },
  async mentors(): Promise<Mentors> {
    return (await api.get('/learning/mentors')).data
  },
  async assignMentor(userId: number, mentorId: number | null): Promise<{ id: number; mentor_id: number | null; mentor: string | null }> {
    return (await api.put(`/learning/mentors/${userId}`, { mentor_id: mentorId })).data
  },
  async hints(): Promise<Hint[]> {
    return (await api.get('/learning/hints')).data
  },
  async saveHint(id: string, hint: { title: string; text: string; details: string; topics: string[] }): Promise<Hint> {
    return (await api.put(`/learning/hints/${id}`, hint)).data
  },
  async deleteHint(id: string): Promise<void> {
    await api.delete(`/learning/hints/${id}`)
  },
  async readiness(userId: number | string): Promise<Readiness> {
    return (await api.get(`/readiness/people/${userId}`)).data
  },
  async openRequests(): Promise<ReadinessRequest[]> {
    return (await api.get('/readiness/requests')).data
  },
  async requestReadiness(userId: number, note: string): Promise<ReadinessRequest> {
    return (await api.post(`/readiness/people/${userId}/request`, { note })).data
  },
  async decide(userId: number, decision: 'promote' | 'not_yet', note: string, role?: string): Promise<ReadinessRequest> {
    return (await api.post(`/readiness/people/${userId}/decision`, { decision, note, role })).data
  },
  async tutor(question: { lesson: string; context: string; question: string; history: { role: 'user' | 'assistant'; content: string }[] }): Promise<string> {
    return (await api.post<{ answer: string }>('/learning/tutor', question)).data.answer
  },
}

export const learningKeys = {
  me: ['learning', 'me'] as const,
  practice: ['learning', 'practice'] as const,
  mentor: ['learning', 'mentor'] as const,
  mentors: ['learning', 'mentors'] as const,
  paths: ['learning', 'paths'] as const,
  hints: ['learning', 'hints'] as const,
  readiness: (userId: number | string) => ['learning', 'readiness', String(userId)] as const,
  requests: ['learning', 'readiness-requests'] as const,
}
