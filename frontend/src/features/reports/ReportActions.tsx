import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Link2, Trash2 } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { apiService } from '@/services/api'
import { Button, ConfirmDialog, Input, Popover, useToast } from '@/ui'
import { reportKeys, reportsApi } from './api'

/** Report page (phase 19): download the zip, share a link that does not expire, delete the report (leads). */
export default function ReportActions({ runId }: { runId: string }) {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canShare = usePermission('report.publish')
  const canManage = usePermission('report.manage')
  const [deleting, setDeleting] = useState(false)
  const links = useQuery({ queryKey: reportKeys.shareLinks(runId), queryFn: () => reportsApi.shareLinks(runId), enabled: canShare })
  const download = useMutation({
    mutationFn: () => reportsApi.downloadZip(runId),
    onError: error => toast({ title: 'No download', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const share = useMutation({
    mutationFn: () => reportsApi.createShareLink(runId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: reportKeys.shareLinks(runId) }),
    onError: error => toast({ title: 'No share link', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const remove = useMutation({
    mutationFn: () => reportsApi.deleteReport(runId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['reports'] }); toast({ title: 'Report deleted', tone: 'success' }); navigate('/reports/list') },
    onError: error => toast({ title: 'Not deleted', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const latest = links.data?.[0]
  const absolute = latest ? `${window.location.origin}${latest.url}` : ''

  return (
    <>
      <Button size="sm" icon={<Download size={13} />} loading={download.isPending} onClick={() => download.mutate()}>Download report (zip)</Button>
      {canShare && (
        <Popover align="end" className="w-96 p-3" trigger={<Button size="sm" icon={<Link2 size={13} />}>Share link</Button>}>
          <div className="space-y-2">
            <p className="text-[13px] font-semibold text-fg">A link for people outside ATM</p>
            <p className="text-xs text-fg-muted">It does not expire and needs no sign-in. Only a lead or a super admin can revoke it.</p>
            {latest ? (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1"><Input label="Share link" value={absolute} readOnly /></div>
                <Button size="sm" icon={<Copy size={13} />} aria-label="Copy the share link"
                  onClick={() => void navigator.clipboard?.writeText(absolute).then(() => toast({ title: 'Link copied', tone: 'success' }))}>Copy</Button>
              </div>
            ) : (
              <Button size="sm" variant="primary" loading={share.isPending} onClick={() => share.mutate()}>Create a share link</Button>
            )}
            {(links.data?.length ?? 0) > 0 && (
              <p className="text-xs text-fg-muted">{links.data!.length} link{links.data!.length === 1 ? '' : 's'} · {links.data!.reduce((n, l) => n + l.views, 0)} views</p>
            )}
          </div>
        </Popover>
      )}
      {canManage && <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setDeleting(true)}>Delete report</Button>}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive title="Delete this report?" confirmLabel="Delete report"
        loading={remove.isPending} onConfirm={() => remove.mutate()}
        description="The Allure report and its files are deleted for good, and its share links stop working. The run and its results stay." />
    </>
  )
}
