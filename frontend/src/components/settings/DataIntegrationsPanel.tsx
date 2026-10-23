import { useEffect, useState } from 'react'
import {
  Plus,
  Trash2,
  Download,
  AlertCircle,
  Check,
  Clock,
  Zap,
  ChevronRight,
} from 'lucide-react'
import apiService from '@/services/api'

interface DataExport {
  id: number
  export_type: string
  format: string
  status: string
  file_url?: string
  file_size: number
  requested_at: string
  completed_at?: string
  expires_at?: string
}

interface Integration {
  id: number
  service_name: string
  service_type: string
  external_workspace_name?: string
  is_active: boolean
  last_sync?: string
  created_at: string
}

interface Webhook {
  id: number
  event_type: string
  target_url: string
  is_active: boolean
  last_delivery?: string
  delivery_count: number
  failure_count: number
  created_at: string
}

const AVAILABLE_INTEGRATIONS = [
  { id: 'github', name: 'GitHub', icon: '🐙', description: 'Code repository management' },
  { id: 'jira', name: 'Jira', icon: '📋', description: 'Issue tracking' },
  { id: 'slack', name: 'Slack', icon: '💬', description: 'Team messaging' },
  { id: 'asana', name: 'Asana', icon: '✓', description: 'Project management' },
]

export default function DataIntegrationsPanel() {
  const [dataExports, setDataExports] = useState<DataExport[]>([])
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expandedIntegration, setExpandedIntegration] = useState<number | null>(null)
  const [showExportForm, setShowExportForm] = useState(false)
  const [exportFormat, setExportFormat] = useState('json')
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [showWebhookForm, setShowWebhookForm] = useState<number | null>(null)
  const [webhookEventType, setWebhookEventType] = useState('')
  const [webhookTargetUrl, setWebhookTargetUrl] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [exportsRes, integrationsRes] = await Promise.all([
        apiService.listDataExports(),
        apiService.listIntegrations(),
      ])
      setDataExports(exportsRes.exports || [])
      setIntegrations(integrationsRes.integrations || [])
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleRequestExport = async () => {
    try {
      setLoading(true)
      const result = await apiService.requestDataExport('full', exportFormat)
      setSuccess(result.message || 'Data export requested successfully!')
      setShowExportForm(false)
      setExportFormat('json')
      await loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleConnectIntegration = async () => {
    if (!selectedIntegration || !authCode) {
      setError('Please select a service and provide auth code')
      return
    }

    try {
      setLoading(true)
      const result = await apiService.connectIntegration(selectedIntegration, authCode)
      setSuccess(result.message || 'Integration connected successfully!')
      setSelectedIntegration(null)
      setAuthCode('')
      await loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnectIntegration = async (integrationId: number) => {
    if (!window.confirm('Are you sure you want to disconnect this integration?')) return

    try {
      setLoading(true)
      const result = await apiService.disconnectIntegration(integrationId)
      setSuccess(result.message || 'Integration disconnected')
      await loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCreateWebhook = async (integrationId: number) => {
    if (!webhookEventType || !webhookTargetUrl) {
      setError('Please fill in all webhook fields')
      return
    }

    try {
      setLoading(true)
      await apiService.createWebhook(integrationId, webhookEventType, webhookTargetUrl)
      setSuccess('Webhook created successfully!')
      setShowWebhookForm(null)
      setWebhookEventType('')
      setWebhookTargetUrl('')
      // Reload webhooks for this integration
      const webhooksRes = await apiService.listWebhooks(integrationId)
      setWebhooks(webhooksRes.webhooks || [])
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded">
          <Check size={14} /> Ready
        </span>
      case 'processing':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
          <Clock size={14} /> Processing
        </span>
      case 'expired':
        return <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded">
          <AlertCircle size={14} /> Expired
        </span>
      default:
        return <span className="text-xs px-2 py-1 bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 rounded">{status}</span>
    }
  }

  return (
    <div className="space-y-8">
      {/* Data Exports Section */}
      <div className="bg-white dark:bg-gray-800/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Download size={24} className="text-blue-600 dark:text-blue-400" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Data Exports</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Download your data in multiple formats</p>
            </div>
          </div>
          <button
            onClick={() => setShowExportForm(!showExportForm)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-800"
          >
            <Plus size={18} /> Request Export
          </button>
        </div>

        {/* Export Form */}
        {showExportForm && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Export Format
                </label>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="xml">XML</option>
                </select>
              </div>
              <button
                onClick={handleRequestExport}
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Requesting...' : 'Request Export'}
              </button>
            </div>
          </div>
        )}

        {/* Exports List */}
        <div className="space-y-3">
          {dataExports.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-sm">No data exports yet</p>
          ) : (
            dataExports.map((exp) => (
              <div key={exp.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{exp.export_type} ({exp.format.toUpperCase()})</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{new Date(exp.requested_at).toLocaleString()}</p>
                  {exp.file_size > 0 && <p className="text-xs text-gray-500 dark:text-gray-500">{(exp.file_size / 1024 / 1024).toFixed(2)} MB</p>}
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(exp.status)}
                  {exp.file_url && (
                    <a href={exp.file_url} className="inline-flex items-center gap-1 px-3 py-1 text-sm bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded hover:bg-green-200">
                      <Download size={16} /> Download
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Integrations Section */}
      <div className="bg-white dark:bg-gray-800/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Zap size={24} className="text-purple-600 dark:text-purple-400" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Integrations</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Connect external services and tools</p>
            </div>
          </div>
        </div>

        {/* Connected Integrations */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Connected</h4>
          <div className="space-y-2">
            {integrations.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400 text-sm">No integrations connected</p>
            ) : (
              integrations.map((integration) => (
                <div key={integration.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedIntegration(expandedIntegration === integration.id ? null : integration.id)}>
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-2 h-2 rounded-full ${integration.is_active ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white capitalize">{integration.service_name}</p>
                        {integration.external_workspace_name && <p className="text-xs text-gray-600 dark:text-gray-400">{integration.external_workspace_name}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ChevronRight size={18} className={`text-gray-400 transition ${expandedIntegration === integration.id ? 'rotate-90' : ''}`} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDisconnectIntegration(integration.id)
                        }}
                        className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Webhooks */}
                  {expandedIntegration === integration.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="font-medium text-gray-900 dark:text-white">Webhooks</h5>
                        <button
                          onClick={() => setShowWebhookForm(showWebhookForm === integration.id ? null : integration.id)}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded hover:bg-blue-200"
                        >
                          Add Webhook
                        </button>
                      </div>

                      {showWebhookForm === integration.id && (
                        <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded space-y-2">
                          <input
                            type="text"
                            placeholder="Event type (e.g., push, pull_request)"
                            value={webhookEventType}
                            onChange={(e) => setWebhookEventType(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                          />
                          <input
                            type="url"
                            placeholder="Target URL"
                            value={webhookTargetUrl}
                            onChange={(e) => setWebhookTargetUrl(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                          />
                          <button
                            onClick={() => handleCreateWebhook(integration.id)}
                            className="w-full px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Create Webhook
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Available Integrations */}
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Available</h4>
          <div className={selectedIntegration ? 'block' : 'grid grid-cols-2 gap-2'}>
            {!selectedIntegration && AVAILABLE_INTEGRATIONS.map((integ) => (
              <button
                key={integ.id}
                onClick={() => setSelectedIntegration(integ.id)}
                className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition"
              >
                <p className="text-2xl mb-1">{integ.icon}</p>
                <p className="font-medium text-sm text-gray-900 dark:text-white">{integ.name}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">{integ.description}</p>
              </button>
            ))}
          </div>

          {selectedIntegration && (
            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  OAuth Code or Token
                </label>
                <input
                  type="password"
                  placeholder="Paste your OAuth token or auth code"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  Get this from your {selectedIntegration} account settings
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleConnectIntegration}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  onClick={() => {
                    setSelectedIntegration(null)
                    setAuthCode('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg flex gap-3">
          <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg flex gap-3">
          <Check size={20} className="text-green-600 dark:text-green-400 flex-shrink-0" />
          <p className="text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}
    </div>
  )
}
