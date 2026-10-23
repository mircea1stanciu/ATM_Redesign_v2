import { useEffect, useState } from 'react'
import {
  AlertCircle, CheckCircle2, Copy, Loader2, Lock, LogOut,
  Smartphone, Calendar, Plus, Trash2, Shield
} from 'lucide-react'
import { apiService } from '@/services/api'

interface Session {
  id: number
  device_name: string
  device_type: string
  browser: string
  os: string
  ip_address: string
  is_active: boolean
  last_activity: string
  created_at: string
  expires_at: string
}

interface APIToken {
  id: number
  token_preview: string
  name: string
  scopes: string
  is_active: boolean
  last_used: string
  created_at: string
  expires_at: string
}

interface LoginEntry {
  id: number
  ip_address: string
  user_agent: string
  device_name: string
  success: boolean
  failure_reason: string
  created_at: string
}

export function SecuritySettingsPanel() {
  const [loginHistory, setLoginHistory] = useState<LoginEntry[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [apiTokens, setApiTokens] = useState<APIToken[]>([])
  const [newToken, setNewToken] = useState<any>(null)
  const [copiedToken, setCopiedToken] = useState(false)

  const [loading, setLoading] = useState(true)
  
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  const [showTokenForm, setShowTokenForm] = useState(false)
  const [tokenName, setTokenName] = useState('')
  const [tokenScopes, setTokenScopes] = useState('')
  const [creatingToken, setCreatingToken] = useState(false)

  useEffect(() => {
    loadSecurityData()
  }, [])

  const loadSecurityData = async () => {
    setLoading(true)
    try {
      const [historyRes, sessionsRes, tokensRes] = await Promise.all([
        apiService.getLoginHistory(20),
        apiService.getUserSessions(),
        apiService.listAPITokens(),
      ])
      setLoginHistory(historyRes.logins)
      setSessions(sessionsRes.sessions)
      setApiTokens(tokensRes.tokens)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCreateToken = async () => {
    if (!tokenName) {
      setError('Token name is required')
      return
    }

    setCreatingToken(true)
    setError(null)
    try {
      const result = await apiService.createAPIToken(tokenName, tokenScopes || undefined)
      setNewToken(result)
      setTokenName('')
      setTokenScopes('')
      setShowTokenForm(false)
      setSuccess('API token created successfully!')
      
      // Reload tokens
      const tokensRes = await apiService.listAPITokens()
      setApiTokens(tokensRes.tokens)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setCreatingToken(false)
    }
  }

  const handleDeleteToken = async (tokenId: number) => {
    if (!confirm('Are you sure you want to revoke this token? Applications using it will stop working.')) {
      return
    }

    try {
      await apiService.deleteAPIToken(tokenId)
      setApiTokens(prev => prev.filter(t => t.id !== tokenId))
      setSuccess('API token revoked successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    }
  }

  const handleLogoutSession = async (sessionId: number) => {
    try {
      await apiService.logoutSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      setSuccess('Logged out from device')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    }
  }

  const handleLogoutAllOthers = async () => {
    if (!confirm('Logout from all other devices? You will only be logged in on this device.')) {
      return
    }

    try {
      await apiService.logoutAllOtherSessions()
      await loadSecurityData()
      setSuccess('Logged out from all other devices')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedToken(true)
    setTimeout(() => setCopiedToken(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={16} className="shrink-0" /> {success}
        </div>
      )}

      {/* New Token Display */}
      {newToken && (
        <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-6">
          <div className="flex items-start gap-3 mb-4">
            <Shield size={20} className="text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-blue-900 dark:text-blue-300">API Token Created</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                Save this token now - you won't be able to see it again!
              </p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700 p-4 font-mono text-sm break-all">
            {newToken.token}
          </div>
          <button
            onClick={() => copyToClipboard(newToken.token)}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium transition"
          >
            <Copy size={16} /> {copiedToken ? 'Copied!' : 'Copy Token'}
          </button>
        </div>
      )}

      {/* Login History */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
            <Calendar size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">Login History</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Recent account access attempts</p>
          </div>
        </div>

        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {loginHistory.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No login history available
            </div>
          ) : (
            loginHistory.map(entry => (
              <div key={entry.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {entry.device_name || 'Unknown Device'}
                      </p>
                      <span className={`inline-block h-2 w-2 rounded-full ${
                        entry.success ? 'bg-emerald-500' : 'bg-red-500'
                      }`} />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {entry.ip_address} • {new Date(entry.created_at).toLocaleString()}
                    </p>
                    {!entry.success && entry.failure_reason && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                        Failed: {entry.failure_reason}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Active Sessions */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 dark:bg-cyan-900/30">
            <Smartphone size={20} className="text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">Active Sessions</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Manage your logged-in devices</p>
          </div>
          {sessions.length > 1 && (
            <button
              onClick={handleLogoutAllOthers}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 transition"
            >
              Logout All Others
            </button>
          )}
        </div>

        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No active sessions
            </div>
          ) : (
            sessions.map(session => (
              <div key={session.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700/30 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">
                    {session.device_name || 'Unknown Device'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {session.browser} on {session.os}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {session.ip_address} • Last active: {new Date(session.last_activity).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => handleLogoutSession(session.id)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 transition"
                >
                  <LogOut size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* API Tokens */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
            <Lock size={20} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">API Tokens</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Personal access tokens for integrations</p>
          </div>
          <button
            onClick={() => setShowTokenForm(!showTokenForm)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 transition flex items-center gap-1"
          >
            <Plus size={14} /> New Token
          </button>
        </div>

        {showTokenForm && (
          <div className="border-b border-gray-200 dark:border-gray-700 p-6 space-y-4 bg-gray-50 dark:bg-gray-700/20">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Token Name</label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g., GitHub Integration"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Scopes (optional)</label>
              <input
                type="text"
                value={tokenScopes}
                onChange={(e) => setTokenScopes(e.target.value)}
                placeholder="e.g., read:posts,write:comments"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowTokenForm(false)}
                className="flex-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateToken}
                disabled={creatingToken}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingToken ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Creating...
                  </>
                ) : (
                  <>
                    <Plus size={14} /> Create Token
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {apiTokens.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No API tokens created yet
            </div>
          ) : (
            apiTokens.map(token => (
              <div key={token.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700/30 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">
                    {token.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">
                    ...{token.token_preview}
                  </p>
                  {token.scopes && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Scopes: {token.scopes}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Created: {new Date(token.created_at).toLocaleDateString()}
                    {token.last_used && ` • Last used: ${new Date(token.last_used).toLocaleString()}`}
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteToken(token.id)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
