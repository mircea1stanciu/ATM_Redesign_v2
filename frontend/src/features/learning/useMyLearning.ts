import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/ui'
import { apiService } from '@/services/api'
import type { MyLearning } from './api'
import { learningApi, learningKeys } from './api'

/** My progress and profile (saved on the server), and the changes to them; each answer replaces the cached copy. */
export function useMyLearning() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const me = useQuery({ queryKey: learningKeys.me, queryFn: learningApi.me })
  const onSuccess = (data: MyLearning) => queryClient.setQueryData(learningKeys.me, data)
  const onError = (error: unknown) => toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' })
  const completeLesson = useMutation({ mutationFn: learningApi.completeLesson, onSuccess, onError })
  const reopenLesson = useMutation({ mutationFn: learningApi.reopenLesson, onSuccess, onError })
  const recordQuiz = useMutation({
    mutationFn: ({ moduleId, score, total }: { moduleId: string; score: number; total: number }) => learningApi.recordQuiz(moduleId, score, total),
    onSuccess, onError,
  })
  const updateProfile = useMutation({ mutationFn: learningApi.updateProfile, onSuccess, onError })
  return { me, completeLesson, reopenLesson, recordQuiz, updateProfile }
}
