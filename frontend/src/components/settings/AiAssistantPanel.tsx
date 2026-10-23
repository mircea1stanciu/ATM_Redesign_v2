import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, BookOpen, Bot, CheckCircle2, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, LogIn, Plug, Save,
  Trash2, XCircle,
} from 'lucide-react'
import { apiService } from '@/services/api'
import type { AiProviderInfo, AiSettings, MicrosoftSignIn } from '@/types/domain'

const DEFAULT_SCOPES = ['Sites.Read.All', 'Mail.Read', 'People.Read.All', 'OnlineMeetingTranscript.Read.All', 'Chat.Read', 'ChannelMessage.Read.All', 'ExternalItem.Read.All']

const PROVIDER_SUBTITLES: Record<AiProviderInfo['id'], string> = {
  github: 'GitHub token · GitHub Models',
  anthropic: 'Anthropic API key',
  azure_openai: 'Company Azure resource · API key',
  rbi_genai: 'RBI account sign-in · genai.rbi.tech',
  microsoft_copilot: 'Work account sign-in · Microsoft Graph',
}

/** Same rules as the backend, to tell whether the saved key belongs to the endpoint in the form. */
function normalizeEndpoint(value: string) {
  let url = value.trim()
  if (!url) return ''
  if (!url.includes('://')) url = `https://${url}`
  try {
    const parsed = new URL(url)
    let path = parsed.pathname.replace(/\/+$/, '')
    for (const suffix of ['/chat/completions', '/responses', '/models']) {
      if (path.endsWith(suffix)) path = path.slice(0, -suffix.length)
    }
    if (path === '' || path === '/openai') path = '/openai/v1'
    return `${parsed.protocol}//${parsed.host}${path}`
  } catch {
    return url
  }
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:underline dark:text-blue-400">
      {children}<ExternalLink size={10} />
    </a>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="ml-4 list-decimal space-y-1.5 marker:text-gray-400">
      {items.map((item, i) => <li key={i} className="pl-1">{item}</li>)}
    </ol>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-gray-100 px-1 py-px font-mono text-[11px] text-gray-800 dark:bg-gray-700 dark:text-gray-100">{children}</code>
}

/** Step-by-step guide for getting credentials for each provider. */
function SetupGuide({ provider, scopes }: { provider: AiProviderInfo['id']; scopes: string[] }) {
  if (provider === 'github') {
    return (
      <div className="space-y-2">
        <Steps items={[
          <>Sign in to <ExtLink href="https://github.com">github.com</ExtLink> with the account that has your GitHub Copilot plan (Copilot Free works too, with lower limits). A token from the company GitHub Enterprise server (e.g. <Code>code.rbi.tech</Code>) does <b>not</b> work here.</>,
          <>Open <b>Settings › Developer settings › Personal access tokens › Fine-grained tokens</b> and click <b>Generate new token</b> (<ExtLink href="https://github.com/settings/personal-access-tokens/new">direct link</ExtLink>).</>,
          <>Give it a name (e.g. <Code>ATM AI assistant</Code>), choose an expiration, and leave <b>Repository access</b> on <b>Public repositories</b>.</>,
          <>Under <b>Permissions › Account permissions</b> set <b>Models</b> to <b>Read-only</b>. No other permission is needed.</>,
          <>Click <b>Generate token</b> and copy it right away (it starts with <Code>github_pat_</Code> and is shown only once).</>,
          <>Paste it below, click <b>Test connection</b>, choose a model (for example <Code>openai/gpt-4.1</Code>) and click <b>Save</b>.</>,
        ]} />
        <p className="text-gray-500 dark:text-gray-400">The models and limits come from your GitHub / Copilot plan. Your network must allow <Code>models.github.ai</Code>.</p>
      </div>
    )
  }
  if (provider === 'rbi_genai') {
    return (
      <div className="space-y-2">
        <Steps items={[
          <>In the <b>RBI IDM portal</b>, shop the permission <b>Coding Agents via RBI GenAI LLM Gateway [your unit code]</b>. It needs three approvals: your line manager, your unit's approvers and the GenAI team. It gives access to the Claude models in <b>PROD</b>.</>,
          <>Keep the environment on <b>PROD</b> (<Code>genai.rbi.tech</Code>). UAT and SBOX need the internal <i>RBI HO (Test)</i> permission, which is only for the gateway team.</>,
          <>Click <b>Sign in with RBI account</b>. A browser tab opens the RBI login (Ping); sign in, then close the tab when it says you are signed in.</>,
          <>Click <b>Test connection</b> to list the models your permission allows, choose one and click <b>Save</b>.</>,
        ]} />
        <p className="text-gray-500 dark:text-gray-400">
          No API key or personal access token: ATM uses a sign-in token for your account (valid about 2 hours) and renews it automatically; when that is no longer possible (usually after a night), sign in again.
          The browser returns the token to ATM on <Code>localhost</Code>, so ATM must run on your own station.
          Details: <ExtLink href="https://code.rbi.tech/raiffeisen/rbi-genai-llm-gw">RBI GenAI LLM Gateway documentation</ExtLink>.
        </p>
      </div>
    )
  }
  if (provider === 'azure_openai') {
    return (
      <div className="space-y-2">
        <Steps items={[
          <>Ask IT / the team that owns the company Azure OpenAI resource for access. You need three values; the endpoint and deployment below are pre-filled with the company's internal sandbox.</>,
          <><b>Endpoint</b>: in the <ExtLink href="https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI">Azure portal</ExtLink> open the Azure OpenAI resource › <b>Keys and Endpoint</b>, copy the endpoint and add <Code>/openai/v1</Code> (e.g. <Code>https://rbro-sandbox-openai.openai.azure.com/openai/v1</Code>). Pasting just the resource URL also works.</>,
          <><b>API key</b>: on the same page copy <b>KEY 1</b> or <b>KEY 2</b>.</>,
          <><b>Deployment name</b>: in <ExtLink href="https://ai.azure.com">Azure AI Foundry</ExtLink> › <b>Deployments</b>, the name of the model deployment to use (e.g. <Code>gpt-5.6-terra</Code>). It is the deployment name, not the model family.</>,
          <>Fill in the fields below, click <b>Test connection</b> and then <b>Save</b>.</>,
        ]} />
        <p className="text-gray-500 dark:text-gray-400">
          ATM calls the OpenAI-compatible <Code>/openai/v1/chat/completions</Code> API of the resource, the same as the
          OpenAI SDK with <Code>base_url</Code> set to the endpoint and <Code>model</Code> set to the deployment name. Data stays in the company's Azure tenant.
        </p>
      </div>
    )
  }
  if (provider === 'anthropic') {
    return (
      <div className="space-y-2">
        <Steps items={[
          <>Sign in to the <ExtLink href="https://console.anthropic.com">Claude Console</ExtLink>. API access needs a Console organisation with billing or credits; a Claude.ai chat subscription does not include API keys.</>,
          <>Go to <b>Settings › API keys</b> (<ExtLink href="https://console.anthropic.com/settings/keys">direct link</ExtLink>) and click <b>Create Key</b>.</>,
          <>Name it (e.g. <Code>ATM AI assistant</Code>), pick the workspace and click <b>Add</b>.</>,
          <>Copy the key right away (it starts with <Code>sk-ant-</Code> and is shown only once).</>,
          <>Paste it below, click <b>Test connection</b>, choose a model and click <b>Save</b>.</>,
        ]} />
        <p className="text-gray-500 dark:text-gray-400">Usage is billed per token to your Console organisation. Your network must allow <Code>api.anthropic.com</Code>.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 font-semibold text-gray-800 dark:text-gray-100">For IT / an Entra administrator (once for the company)</p>
        <Steps items={[
          <>In the <ExtLink href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Microsoft Entra admin center › App registrations</ExtLink> click <b>New registration</b>. Name it <Code>ATM AI assistant</Code>, choose <b>Accounts in this organizational directory only</b>; no redirect URI is needed.</>,
          <>Open <b>Authentication</b>, set <b>Allow public client flows</b> to <b>Yes</b> and save (required for the device-code sign-in).</>,
          <>Open <b>API permissions › Add a permission › Microsoft Graph › Delegated permissions</b> and add all of: {scopes.map((s, i) => <span key={s}><Code>{s}</Code>{i < scopes.length - 1 ? ', ' : ''}</span>)}. The Copilot Chat API requires every one of them.</>,
          <>Click <b>Grant admin consent</b> for the organisation.</>,
          <>From <b>Overview</b>, share the <b>Directory (tenant) ID</b> and the <b>Application (client) ID</b> with the users.</>,
        ]} />
      </div>
      <div>
        <p className="mb-1.5 font-semibold text-gray-800 dark:text-gray-100">For each user</p>
        <Steps items={[
          <>Make sure you have a <b>Microsoft 365 Copilot</b> licence (ask IT if you are not sure).</>,
          <>Enter the tenant ID and client ID below and click <b>Sign in with Microsoft</b>.</>,
          <>Open <ExtLink href="https://microsoft.com/devicelogin">microsoft.com/devicelogin</ExtLink>, enter the code ATM shows, sign in with your work account and accept.</>,
          <>Back here, click <b>Test connection</b>.</>,
        ]} />
      </div>
      <p className="text-gray-500 dark:text-gray-400">
        There is no API key: ATM keeps a sign-in token for your account and renews it automatically. Copilot chooses the
        model itself. The Microsoft 365 Copilot Chat API is currently a Microsoft preview (beta) API.
      </p>
    </div>
  )
}

export default function AiAssistantPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState<AiProviderInfo['id'] | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | 'signin' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [guideOpen, setGuideOpen] = useState(true)
  const [signIn, setSignIn] = useState<MicrosoftSignIn | null>(null)
  const pollTimer = useRef<number | null>(null)
  const [rbiEnv, setRbiEnv] = useState('prod')
  const [rbiSignIn, setRbiSignIn] = useState<{ loginUrl: string; expiresAt: number } | null>(null)
  const rbiTimer = useRef<number | null>(null)

  // Detect every model of the saved connection, so the picker is filled without a manual test.
  const providerRef = useRef('')
  providerRef.current = provider
  const loadSavedModels = (data: AiSettings) => {
    if (!data.configured || data.provider === 'microsoft_copilot') return
    apiService.getAiModels().then(response => {
      if (response.ok && providerRef.current === data.provider) setModels(response.models)
    }).catch(() => undefined)
  }

  useEffect(() => {
    apiService.getAiSettings().then(data => {
      setSettings(data)
      loadSavedModels(data)
      setProvider((data.provider as AiProviderInfo['id']) || data.providers[0]?.id || '')
      setModel(data.model)
      const initial = data.providers.find(p => p.id === (data.provider || data.providers[0]?.id))
      setEndpoint(data.endpoint || initial?.default_endpoint || '')
      if ((initial?.id === 'azure_openai' || initial?.id === 'rbi_genai') && !data.model) setModel(initial.default_model)
      const gateway = data.providers.find(p => p.id === 'rbi_genai')
      setRbiEnv(data.environment || gateway?.default_environment || 'prod')
      setTenantId(data.tenant_id)
      setClientId(data.client_id)
      setGuideOpen(!data.configured)
    }).catch(e => setResult({ ok: false, message: apiService.errorMessage(e) }))
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
      if (rbiTimer.current) window.clearTimeout(rbiTimer.current)
    }
  }, [])

  const info = useMemo(() => settings?.providers.find(p => p.id === provider) ?? null, [settings, provider])
  const sameProvider = settings?.provider === provider
  const microsoft = info?.auth === 'device_code'
  const azure = provider === 'azure_openai'
  const rbi = provider === 'rbi_genai'
  const rbiConnected = rbi && sameProvider && !!settings?.configured
  // A sign-in is valid for one environment; switching environment needs a new sign-in.
  const rbiEnvMismatch = rbiConnected && (settings?.environment || 'prod') !== rbiEnv
  const rbiEnvName = (id?: string) => settings?.rbi_environments.find(e => e.id === id)?.name ?? (id || '').toUpperCase()
  // A saved Azure key is only reused for the endpoint it was saved for.
  const sameEndpoint = !azure || normalizeEndpoint(endpoint) === normalizeEndpoint(settings?.endpoint ?? '')
  const keyRequired = !(sameProvider && settings?.api_key_set && sameEndpoint)
  const deploymentInvalid = azure && !!info?.models?.length && !info.models.includes(model)
  // Azure: the deployments detected by Test connection, otherwise the allowed list.
  const azureDeployments = azure && models.length ? models.map(m => m.id) : info?.models ?? []
  const formValues = () => ({
    provider: provider as string,
    api_key: apiKey.trim() || undefined,
    model: model.trim(),
    ...(azure ? { endpoint: endpoint.trim() } : {}),
  })

  const stopPolling = () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current)
    pollTimer.current = null
    setSignIn(null)
  }

  const stopRbi = () => {
    if (rbiTimer.current) window.clearTimeout(rbiTimer.current)
    rbiTimer.current = null
    setRbiSignIn(null)
  }

  const pickProvider = (id: AiProviderInfo['id']) => {
    stopPolling()
    stopRbi()
    setProvider(id)
    setModels([])
    setResult(null)
    setApiKey('')
    const next = settings?.providers.find(p => p.id === id)
    setModel(id === settings?.provider ? settings.model : id === 'azure_openai' || id === 'rbi_genai' ? next?.default_model ?? '' : '')
    setEndpoint(id === settings?.provider && settings.endpoint ? settings.endpoint : next?.default_endpoint ?? '')
    setGuideOpen(!(id === settings?.provider && settings?.configured))
    if (id === settings?.provider && settings) loadSavedModels(settings)
  }

  const test = async () => {
    setBusy('test')
    setResult(null)
    try {
      const response = await apiService.testAiSettings(microsoft
        ? { provider: provider as string }
        : formValues())
      setResult({ ok: response.ok, message: response.message })
      if (!microsoft) {
        setModels(response.models)
        if (response.ok && !model && response.models.length) {
          setModel(response.models.find(m => m.id === info?.default_model)?.id ?? response.models[0].id)
        }
      }
    } catch (e) {
      setResult({ ok: false, message: apiService.errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    setResult(null)
    try {
      const saved = await apiService.saveAiSettings(formValues())
      setSettings(saved)
      setApiKey('')
      setGuideOpen(false)
      setResult({ ok: true, message: 'Saved. The assistant is available in Projects › AI Driven implementation.' })
    } catch (e) {
      setResult({ ok: false, message: apiService.errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const poll = (interval: number) => {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const response = await apiService.pollMicrosoftSignIn()
        if (response.status === 'done' && response.settings) {
          setSettings(response.settings)
          setSignIn(null)
          setGuideOpen(false)
          setResult({ ok: true, message: `Signed in as ${response.settings.account || 'your work account'}. Click Test connection to check Copilot access.` })
          return
        }
        if (response.status === 'pending' || response.status === 'slow_down') {
          poll(response.status === 'slow_down' ? interval + 5 : interval)
          return
        }
        setSignIn(null)
        setResult({ ok: false, message: response.message || 'Sign-in did not complete.' })
      } catch (e) {
        setSignIn(null)
        setResult({ ok: false, message: apiService.errorMessage(e) })
      }
    }, interval * 1000)
  }

  const startSignIn = async () => {
    stopPolling()
    setBusy('signin')
    setResult(null)
    try {
      const flow = await apiService.startMicrosoftSignIn({
        tenant_id: tenantId.trim(),
        client_id: clientId.trim(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      setSignIn(flow)
      poll(flow.interval || 5)
    } catch (e) {
      setResult({ ok: false, message: apiService.errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const pollRbi = () => {
    rbiTimer.current = window.setTimeout(async () => {
      try {
        const response = await apiService.pollRbiSignIn()
        if (response.status === 'pending') {
          pollRbi()
          return
        }
        setRbiSignIn(null)
        if (response.status === 'done' && response.settings) {
          setSettings(response.settings)
          setModel(response.settings.model)
          setGuideOpen(false)
          loadSavedModels(response.settings)
          setResult({ ok: true, message: `Signed in${response.settings.account ? ` as ${response.settings.account}` : ''} (${rbiEnvName(response.settings.environment)}). Click Test connection to list the models you can use.` })
          return
        }
        setResult({ ok: false, message: response.message || 'Sign-in did not complete.' })
      } catch (e) {
        setRbiSignIn(null)
        setResult({ ok: false, message: apiService.errorMessage(e) })
      }
    }, 2000)
  }

  const startRbiSignIn = async () => {
    stopRbi()
    setBusy('signin')
    setResult(null)
    // Open the tab while handling the click so pop-up blockers allow it; the URL is set once ATM has it.
    const tab = window.open('', '_blank')
    try {
      const flow = await apiService.startRbiSignIn(rbiEnv)
      if (tab) tab.location.href = flow.login_url
      setRbiSignIn({ loginUrl: flow.login_url, expiresAt: Date.now() + flow.expires_in * 1000 })
      pollRbi()
    } catch (e) {
      tab?.close()
      setResult({ ok: false, message: apiService.errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const cancelRbiSignIn = () => {
    stopRbi()
    void apiService.cancelRbiSignIn().catch(() => undefined)
  }

  const remove = async () => {
    if (!window.confirm('Remove your AI assistant connection? The stored key or Microsoft sign-in is deleted.')) return
    stopPolling()
    stopRbi()
    setBusy('delete')
    try {
      const cleared = await apiService.deleteAiSettings()
      setSettings(cleared)
      setApiKey('')
      setModel('')
      setGuideOpen(true)
      setResult({ ok: true, message: 'Connection removed.' })
    } catch (e) {
      setResult({ ok: false, message: apiService.errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!settings) {
    return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
  }

  const connectedName = settings.providers.find(p => p.id === settings.provider)?.name
  const msConnected = microsoft && sameProvider && settings.configured

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-gray-700/70 dark:bg-gray-800/90">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Bot size={20} className="mt-0.5 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">AI assistant connection</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Used by Projects › AI Driven implementation to analyse your local project and help implement tests.
              The connection is personal: your credentials are stored for your account only and never shown again.
            </p>
          </div>
        </div>
        {settings.configured && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 size={12} /> {connectedName}{settings.provider === 'microsoft_copilot' ? (settings.account ? ` · ${settings.account}` : '') : ` · ${settings.model || 'default model'}`}{settings.provider === 'rbi_genai' ? ` · ${rbiEnvName(settings.environment)}` : ''}
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {settings.providers.map(p => (
          <button
            key={p.id}
            onClick={() => pickProvider(p.id)}
            className={`rounded-xl border p-3 text-left transition ${provider === p.id
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-500/10'
              : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'}`}
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{p.name}</p>
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              {PROVIDER_SUBTITLES[p.id]}
            </p>
          </button>
        ))}
      </div>

      {info && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 text-xs text-gray-700 dark:border-blue-500/20 dark:bg-blue-500/5 dark:text-gray-300">
          <button onClick={() => setGuideOpen(o => !o)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-semibold text-blue-700 dark:text-blue-300">
            {guideOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<BookOpen size={13} />
            {microsoft ? 'How to set up Microsoft 365 Copilot' : azure ? 'How to connect Azure OpenAI' : rbi ? 'How to connect the RBI GenAI LLM Gateway' : `How to get the ${info.key_label}`}
          </button>
          {guideOpen && <div className="px-4 pb-3 leading-relaxed"><SetupGuide provider={info.id} scopes={settings.graph_scopes?.length ? settings.graph_scopes : DEFAULT_SCOPES} /></div>}
        </div>
      )}

      {info && azure && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Endpoint</label>
            <input className="form-input font-mono !text-xs" value={endpoint} onChange={e => setEndpoint(e.target.value)}
              placeholder={info.default_endpoint || 'https://<resource>.openai.azure.com/openai/v1'} />
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">The resource's OpenAI v1 base URL (…/openai/v1).</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Deployment name</label>
            {azureDeployments.length ? (
              <select className="form-input font-mono !text-xs" value={model} onChange={e => setModel(e.target.value)}>
                {!azureDeployments.includes(model) && <option value={model} disabled>{model ? `${model} (not allowed)` : 'Choose a deployment'}</option>}
                {azureDeployments.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <input className="form-input font-mono !text-xs" value={model} onChange={e => setModel(e.target.value)}
                placeholder={info.default_model || 'deployment name'} />
            )}
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {models.length
                ? `${models.length} deployments answered for this key. `
                : info.models?.length ? 'The models deployed on the company Azure OpenAI resource; Test connection detects the ones your key can use. ' : ''}Sent as the model.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{info.key_label}</label>
            <input className="form-input font-mono !text-xs" type="password" autoComplete="off" value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={!keyRequired ? `${settings.api_key_preview} (leave empty to keep)` : 'Paste the key'} />
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {info.key_hint}{sameProvider && settings.api_key_set && !sameEndpoint ? ' The endpoint changed, so enter the key for it.' : ''}
            </p>
          </div>
        </div>
      )}

      {info && rbi && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Environment</label>
              <select className="form-input !text-xs" value={rbiEnv} onChange={e => setRbiEnv(e.target.value)} disabled={Boolean(rbiSignIn)}>
                {settings.rbi_environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name} · {env.gateway.replace(/^https:\/\//, '')}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {rbiEnvMismatch ? `You are signed in to ${rbiEnvName(settings.environment)}: sign in again to switch.` : 'PROD for normal use.'}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Model</label>
              {models.length > 0 ? (
                <select className="form-input font-mono !text-xs" value={model} onChange={e => setModel(e.target.value)}>
                  {!models.some(m => m.id === model) && <option value={model}>{model || 'Choose a model'}</option>}
                  {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              ) : (
                <input className="form-input font-mono !text-xs" value={model} onChange={e => setModel(e.target.value)}
                  placeholder={info.default_model || 'model name'} />
              )}
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {models.length ? `${models.length} models allowed for your account.` : 'Test the connection to list the models your permission allows.'}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{info.key_hint}</p>
          {rbiConnected && !rbiSignIn && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={13} /> Signed in{settings.account ? ` as ${settings.account}` : ''} · {rbiEnvName(settings.environment)}
            </p>
          )}
          {rbiSignIn && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-gray-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-gray-200">
              <p className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Finish signing in with your RBI account in the browser tab that opened…
                <button onClick={cancelRbiSignIn} className="ml-2 font-medium text-gray-500 underline">Cancel</button>
              </p>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                No tab? <a href={rbiSignIn.loginUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Open the RBI sign-in page</a>.
                The sign-in expires in about {Math.max(1, Math.round((rbiSignIn.expiresAt - Date.now()) / 60000))} minutes.
              </p>
            </div>
          )}
        </div>
      )}

      {info && !microsoft && !azure && !rbi && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{info.key_label}</label>
            <input className="form-input font-mono !text-xs" type="password" autoComplete="off" value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={sameProvider && settings.api_key_set ? `${settings.api_key_preview} (leave empty to keep)` : 'Paste the key'} />
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{info.key_hint}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Model</label>
            {models.length > 0 ? (
              <select className="form-input !text-xs" value={model} onChange={e => setModel(e.target.value)}>
                {!models.some(m => m.id === model) && <option value={model}>{model || 'Choose a model'}</option>}
                {models.map(m => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
              </select>
            ) : (
              <input className="form-input font-mono !text-xs" value={model} onChange={e => setModel(e.target.value)}
                placeholder={info.default_model || 'model name'} />
            )}
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {models.length ? `${models.length} models available to this account.` : 'Test the connection to list the available models.'}
            </p>
          </div>
        </div>
      )}

      {info && microsoft && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Directory (tenant) ID</label>
              <input className="form-input font-mono !text-xs" value={tenantId} onChange={e => setTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx or company.onmicrosoft.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Application (client) ID</label>
              <input className="form-input font-mono !text-xs" value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </div>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{info.key_hint}</p>
          {msConnected && !signIn && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={13} /> Signed in{settings.account ? ` as ${settings.account}` : ''}.
            </p>
          )}
          {signIn && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/30 dark:bg-blue-500/10">
              <p className="text-sm text-gray-800 dark:text-gray-100">
                Open <ExtLink href={signIn.verification_uri}>{signIn.verification_uri.replace(/^https?:\/\//, '')}</ExtLink>, enter this code
                and sign in with your work account:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded-lg bg-white px-3 py-1.5 font-mono text-lg font-bold tracking-widest text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white">{signIn.user_code}</span>
                <button onClick={() => void navigator.clipboard?.writeText(signIn.user_code)} className="btn-secondary !px-2 !py-1 text-[11px]"><Copy size={12} /> Copy</button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <Loader2 size={12} className="animate-spin" /> Waiting for you to finish signing in… (the code is valid for about {Math.round(signIn.expires_in / 60)} minutes)
                <button onClick={stopPolling} className="ml-2 font-medium text-gray-500 underline">Cancel</button>
              </p>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${result.ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300'}`}>
          {result.ok ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <XCircle size={14} className="mt-px shrink-0" />}
          <span className="break-words">{result.message}</span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
        <AlertTriangle size={13} className="mt-px shrink-0" />
        <span>
          Project files you share with the assistant are sent to the selected provider. Values of password/token/key
          settings are masked and .env, key and certificate files are never sent. Follow your company's AI usage policy;
          if a provider is blocked on your network, use a company-approved one.
        </span>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {settings.configured && (
          <button onClick={() => void remove()} disabled={busy !== null} className="btn-ghost text-red-600">
            {busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
          </button>
        )}
        {rbi ? (
          <>
            <button onClick={() => void test()} disabled={busy !== null || !rbiConnected || rbiEnvMismatch || Boolean(rbiSignIn) || !model.trim()} className="btn-secondary"
              title={rbiConnected ? undefined : 'Sign in first'}>
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Test connection
            </button>
            <button onClick={() => void startRbiSignIn()} disabled={busy !== null || Boolean(rbiSignIn)} className={rbiConnected && !rbiEnvMismatch ? 'btn-secondary' : 'btn-primary'}>
              {busy === 'signin' ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} {rbiConnected ? 'Sign in again' : 'Sign in with RBI account'}
            </button>
            {rbiConnected && !rbiEnvMismatch && (
              <button onClick={() => void save()} disabled={busy !== null || !model.trim() || model === settings.model} className="btn-primary">
                {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save model
              </button>
            )}
          </>
        ) : microsoft ? (
          <>
            <button onClick={() => void test()} disabled={busy !== null || !msConnected || Boolean(signIn)} className="btn-secondary"
              title={msConnected ? undefined : 'Sign in first'}>
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Test connection
            </button>
            <button onClick={() => void startSignIn()} disabled={busy !== null || Boolean(signIn) || !tenantId.trim() || !clientId.trim()} className="btn-primary">
              {busy === 'signin' ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} {msConnected ? 'Sign in again' : 'Sign in with Microsoft'}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => void test()} disabled={busy !== null || (keyRequired && !apiKey.trim()) || deploymentInvalid} className="btn-secondary">
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Test connection
            </button>
            <button onClick={() => void save()} disabled={busy !== null || (keyRequired && !apiKey.trim()) || deploymentInvalid} className="btn-primary">
              {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          </>
        )}
      </div>
    </div>
  )
}
