import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
import { apiService } from '@/services/api'
import { Button, Card, ConfirmDialog, ErrorState, Input, Select, Skeleton, useToast } from '@/ui'
import type { MailSecurity, MailServer } from '@/features/notifications/api'
import { notificationKeys, notificationsApi } from '@/features/notifications/api'

const PORTS: Record<MailSecurity, number> = { starttls: 587, ssl: 465, none: 25 }

function MailServerForm({ server }: { server: MailServer }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const saved = server.configured ? server : null
  const [host, setHost] = useState(saved?.host ?? '')
  const [security, setSecurity] = useState<MailSecurity>(saved?.security ?? 'starttls')
  const [port, setPort] = useState(String(saved?.port ?? PORTS.starttls))
  const [username, setUsername] = useState(saved?.username ?? '')
  const [password, setPassword] = useState('')
  const [sender, setSender] = useState(saved?.sender ?? '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const done = (data: MailServer) => {
    queryClient.setQueryData(notificationKeys.mailServer, data)
    void queryClient.invalidateQueries({ queryKey: notificationKeys.subscriptions })
  }
  const save = useMutation({
    mutationFn: () => notificationsApi.saveMailServer({
      host: host.trim(), port: Number(port), security, username: username.trim() || null, password: password ? password : null, sender: sender.trim(),
    }),
    onSuccess: data => { done(data); setPassword(''); toast({ title: 'Mail server saved', tone: 'success' }) },
    onError: error => toast({ title: 'Not saved', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const test = useMutation({
    mutationFn: notificationsApi.testMailServer,
    onSuccess: result => toast({ title: `Test e-mail sent to ${result.sent_to}`, tone: 'success' }),
    onError: error => toast({ title: 'The test e-mail was not sent', description: apiService.errorMessage(error), tone: 'danger' }),
  })
  const remove = useMutation({
    mutationFn: notificationsApi.removeMailServer,
    onSuccess: data => { done(data); setConfirmRemove(false); toast({ title: 'Mail server removed: no more e-mails', tone: 'success' }) },
  })
  return (
    <Card className="max-w-xl space-y-4 p-4">
      <p className="flex items-start gap-2 text-[13px] text-fg-muted">
        <Mail size={15} className="mt-0.5 shrink-0" aria-hidden />
        People choose in Notifications which notifications they also get by e-mail; ATM sends them through this server.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <Input label="SMTP server" value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.example.com" />
        <Input label="Port" type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)} />
      </div>
      <Select label="Security" value={security} onChange={e => {
        const next = e.target.value as MailSecurity
        if (port === String(PORTS[security])) setPort(String(PORTS[next]))
        setSecurity(next)
      }}>
        <option value="starttls">STARTTLS (usually port 587)</option>
        <option value="ssl">SSL/TLS (usually port 465)</option>
        <option value="none">None (only inside a trusted network)</option>
      </Select>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="User name (optional)" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" />
        <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password"
          placeholder={saved?.password_set ? 'Saved. Type to replace it' : ''} />
      </div>
      <Input label="Sender address" type="email" value={sender} onChange={e => setSender(e.target.value)} placeholder="atm@example.com" />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={save.isPending} disabled={!host.trim() || !sender.trim() || !Number(port)} onClick={() => save.mutate()}>Save</Button>
        {saved && <Button loading={test.isPending} onClick={() => test.mutate()}>Send me a test e-mail</Button>}
        {saved && <Button variant="ghost" onClick={() => setConfirmRemove(true)}>Remove</Button>}
      </div>
      <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title="Remove the mail server?"
        description="ATM stops sending e-mails. People's choices are kept for when a server is set again."
        confirmLabel="Remove" destructive loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </Card>
  )
}

/** Admin › E-mail (Super Admins, phase 20): the SMTP server e-mail notifications go through. */
export default function MailServerPage() {
  const server = useQuery({ queryKey: notificationKeys.mailServer, queryFn: notificationsApi.mailServer })
  if (server.isPending) return <Skeleton className="h-64 max-w-xl" />
  if (server.isError) return <ErrorState title="Could not load the mail server">{apiService.errorMessage(server.error)}</ErrorState>
  return <MailServerForm server={server.data} />
}
