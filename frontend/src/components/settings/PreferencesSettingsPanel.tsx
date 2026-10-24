import { useEffect, useState } from 'react'
import {
  AlertCircle, CheckCircle2, Loader2, Palette, Zap, Bell
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { useTheme } from '@/app/theme'
import { apiService } from '@/services/api'

export function PreferencesSettingsPanel() {
  const { user } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState<string>('system')
  const [aiPrefs, setAiPrefs] = useState({
    preferred_model: 'gpt-4',
    provider: 'openai',
    temperature: 0.7,
  })
  const [notifications, setNotifications] = useState({
    email_forum_posts: true,
    email_comments: true,
    email_mentions: true,
    email_community_updates: false,
    email_digest_frequency: 'weekly',
    in_app_forum_posts: true,
    in_app_comments: true,
    in_app_mentions: true,
    in_app_system: true,
    push_enabled: false,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
  })

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadPreferences()
    // Load once when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPreferences = async () => {
    setLoading(true)
    try {
      const [themeRes, aiRes, notifRes] = await Promise.all([
        Promise.resolve({ theme_preference: user?.theme_preference || 'system' }),
        apiService.getAIPreferences().catch(() => ({
          preferred_model: 'gpt-4',
          provider: 'openai',
          temperature: 0.7,
        })),
        apiService.getNotificationPreferences().catch(() => ({})),
      ])
      
      setTheme(themeRes.theme_preference)
      setAiPrefs(aiRes)
      setNotifications(prev => ({ ...prev, ...notifRes }))
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleThemeChange = async (newTheme: string) => {
    setSaving(true)
    setError(null)
    try {
      await apiService.updateTheme(newTheme)
      setTheme(newTheme)
      if (newTheme === 'light' || newTheme === 'dark' || newTheme === 'system') useTheme.getState().setPreference(newTheme)
      setSuccess('Theme preference updated')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleAIPreferencesChange = async (field: string, value: any) => {
    const newPrefs = { ...aiPrefs, [field]: value }
    setAiPrefs(newPrefs)
    setSaving(true)
    setError(null)
    
    try {
      await apiService.updateAIPreferences(
        newPrefs.preferred_model,
        newPrefs.provider,
        newPrefs.temperature
      )
      setSuccess('AI preferences updated')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
      setAiPrefs(aiPrefs) // Revert on error
    } finally {
      setSaving(false)
    }
  }

  const handleNotificationChange = async (field: string, value: any) => {
    const newNotifications = { ...notifications, [field]: value }
    setNotifications(newNotifications)
    setSaving(true)
    setError(null)

    try {
      await apiService.updateNotificationPreferences(newNotifications)
      setSuccess('Notification preferences updated')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
      setNotifications(notifications) // Revert on error
    } finally {
      setSaving(false)
    }
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

      {/* Theme Preference */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/30">
            <Palette size={20} className="text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">Theme & Display</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Customize your interface appearance</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Theme Preference
            </label>
            <div className="grid grid-cols-3 gap-3">
              {['light', 'dark', 'system'].map(themeOption => (
                <button
                  key={themeOption}
                  onClick={() => handleThemeChange(themeOption)}
                  disabled={saving}
                  className={`rounded-lg px-4 py-3 text-sm font-medium transition capitalize ${
                    theme === themeOption
                      ? 'bg-blue-600 dark:bg-blue-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {themeOption}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* AI Assistant Preferences */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
            <Zap size={20} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">AI Assistant</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Configure your AI assistant preferences</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Preferred Model
            </label>
            <select
              value={aiPrefs.preferred_model}
              onChange={(e) => handleAIPreferencesChange('preferred_model', e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5">GPT-3.5 Turbo</option>
              <option value="claude-3-opus">Claude 3 Opus</option>
              <option value="claude-3-sonnet">Claude 3 Sonnet</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Provider
            </label>
            <select
              value={aiPrefs.provider}
              onChange={(e) => handleAIPreferencesChange('provider', e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Temperature: {aiPrefs.temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={aiPrefs.temperature}
              onChange={(e) => handleAIPreferencesChange('temperature', parseFloat(e.target.value))}
              disabled={saving}
              className="w-full rounded-lg accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Lower values make responses more focused and deterministic. Higher values make them more creative and random.
            </p>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
            <Bell size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">Notifications</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Control how you receive updates</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Email Notifications */}
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-3">Email Notifications</h3>
            <div className="space-y-2">
              {[
                { key: 'email_forum_posts', label: 'Forum Posts' },
                { key: 'email_comments', label: 'Comments on my posts' },
                { key: 'email_mentions', label: 'When I\'m mentioned' },
                { key: 'email_community_updates', label: 'Community updates' },
              ].map(item => (
                <label key={item.key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifications[item.key as keyof typeof notifications] as boolean}
                    onChange={(e) => handleNotificationChange(item.key, e.target.checked)}
                    disabled={saving}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* In-app Notifications */}
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-3">In-App Notifications</h3>
            <div className="space-y-2">
              {[
                { key: 'in_app_forum_posts', label: 'Forum Posts' },
                { key: 'in_app_comments', label: 'Comments on my posts' },
                { key: 'in_app_mentions', label: 'When I\'m mentioned' },
                { key: 'in_app_system', label: 'System announcements' },
              ].map(item => (
                <label key={item.key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifications[item.key as keyof typeof notifications] as boolean}
                    onChange={(e) => handleNotificationChange(item.key, e.target.checked)}
                    disabled={saving}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Email Digest */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email Digest Frequency
            </label>
            <select
              value={notifications.email_digest_frequency}
              onChange={(e) => handleNotificationChange('email_digest_frequency', e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="immediate">Immediate</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="never">Never</option>
            </select>
          </div>

          {/* Quiet Hours */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={notifications.quiet_hours_enabled}
                onChange={(e) => handleNotificationChange('quiet_hours_enabled', e.target.checked)}
                disabled={saving}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable quiet hours</span>
            </label>

            {notifications.quiet_hours_enabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Start time
                  </label>
                  <input
                    type="time"
                    value={notifications.quiet_hours_start || '22:00'}
                    onChange={(e) => handleNotificationChange('quiet_hours_start', e.target.value)}
                    disabled={saving}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    End time
                  </label>
                  <input
                    type="time"
                    value={notifications.quiet_hours_end || '08:00'}
                    onChange={(e) => handleNotificationChange('quiet_hours_end', e.target.value)}
                    disabled={saving}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
