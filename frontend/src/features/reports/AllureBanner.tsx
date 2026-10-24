import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { Button, useToast } from '@/ui'
import { reportKeys, reportsApi } from './api'

/** Reports (phase 19): Allure is missing (or Java is): leads install it here, others are told whom to ask. */
export default function AllureBanner() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const canInstall = usePermission('report.manage')
  const status = useQuery({ queryKey: reportKeys.allure, queryFn: reportsApi.allureStatus })
  const install = useMutation({
    mutationFn: reportsApi.installAllure,
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: reportKeys.allure })
      toast({ title: 'Allure installed', description: result.java ? undefined : 'Java is still missing: install a Java runtime.', tone: result.java ? 'success' : 'warning' })
    },
    onError: error => toast({ title: 'Allure was not installed', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  if (!status.data || (status.data.installed && status.data.java)) return null
  const { installed } = status.data
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg">
      <AlertTriangle size={15} className="text-warning" aria-hidden />
      <span className="flex-1">
        {installed
          ? 'Allure is installed, but Java was not found: reports cannot be generated until a Java runtime (for example Eclipse Temurin 21) is installed on this station.'
          : 'The Allure command line is not installed on this station, so runs get no report.'}
        {!installed && !canInstall && ' Ask your Automation Lead to install it.'}
      </span>
      {!installed && canInstall && <Button size="sm" variant="primary" loading={install.isPending} onClick={() => install.mutate()}>Install Allure</Button>}
    </div>
  )
}
