import { useEffect, useState } from 'react'
import {
  AlertCircle, CheckCircle2, Loader2, Users, Shield, X
} from 'lucide-react'
import { apiService } from '@/services/api'

const AVAILABLE_COMMUNITIES = [
  { id: 'qa', label: 'QA Testing' },
  { id: 'backend', label: 'Backend Development' },
  { id: 'frontend', label: 'Frontend Development' },
  { id: 'design', label: 'Design & UX' },
  { id: 'devops', label: 'DevOps & Infrastructure' },
  { id: 'product', label: 'Product Management' },
  { id: 'security', label: 'Security' },
  { id: 'documentation', label: 'Documentation' },
]

export function CommunityPrivacyPanel() {
  const [loading, setLoading] = useState(true)
  const [preferredCommunities, setPreferredCommunities] = useState<string[]>([])
  const [privacySettings, setPrivacySettings] = useState({
    profile_public: true,
    show_activity: true,
    show_email: false,
    allow_messages: true,
    allow_mentions: true,
    allow_analytics: true,
    allow_marketing: false,
  })

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const [communitiesRes, privacyRes] = await Promise.all([
        apiService.getCommunityPreferences(),
        apiService.getPrivacySettings().catch(() => ({})),
      ])
      setPreferredCommunities(communitiesRes.preferred_communities || [])
      setPrivacySettings(prev => ({ ...prev, ...privacyRes }))
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleToggleCommunity = async (communityId: string) => {
    const newCommunities = preferredCommunities.includes(communityId)
      ? preferredCommunities.filter(c => c !== communityId)
      : [...preferredCommunities, communityId]

    setPreferredCommunities(newCommunities)
    setSaving(true)
    setError(null)

    try {
      await apiService.updateCommunityPreferences(newCommunities)
      setSuccess('Community preferences updated')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
      // Revert on error
      setPreferredCommunities(preferredCommunities)
    } finally {
      setSaving(false)
    }
  }

  const handlePrivacyChange = async (field: string, value: boolean) => {
    const newSettings = { ...privacySettings, [field]: value }
    setPrivacySettings(newSettings)
    setSaving(true)
    setError(null)

    try {
      await apiService.updatePrivacySettings(newSettings)
      setSuccess('Privacy settings updated')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
      // Revert on error
      setPrivacySettings(privacySettings)
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

      {/* Community Preferences */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
            <Users size={20} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">Community Preferences</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Select communities you're interested in</p>
          </div>
        </div>

        <div className="p-6">
          {preferredCommunities.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
                Selected ({preferredCommunities.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {preferredCommunities.map(communityId => {
                  const community = AVAILABLE_COMMUNITIES.find(c => c.id === communityId)
                  return (
                    <button
                      key={communityId}
                      onClick={() => handleToggleCommunity(communityId)}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-3 py-1.5 text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {community?.label}
                      <X size={14} />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
              Available Communities
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AVAILABLE_COMMUNITIES.map(community => (
                <button
                  key={community.id}
                  onClick={() => handleToggleCommunity(community.id)}
                  disabled={saving}
                  className={`p-4 rounded-lg border-2 transition text-left disabled:opacity-50 disabled:cursor-not-allowed ${
                    preferredCommunities.includes(community.id)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={preferredCommunities.includes(community.id)}
                      readOnly
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white text-sm">
                        {community.label}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Privacy Settings */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
            <Shield size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">Privacy Settings</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Control your visibility and privacy</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {[
            {
              key: 'profile_public',
              label: 'Public Profile',
              description: 'Allow others to view your profile'
            },
            {
              key: 'show_activity',
              label: 'Show Activity',
              description: 'Display your recent activity to others'
            },
            {
              key: 'show_email',
              label: 'Show Email',
              description: 'Make your email address visible'
            },
            {
              key: 'allow_messages',
              label: 'Allow Direct Messages',
              description: 'Enable others to send you direct messages'
            },
            {
              key: 'allow_mentions',
              label: 'Allow Mentions',
              description: 'Allow others to mention you in posts and comments'
            },
            {
              key: 'allow_analytics',
              label: 'Share Usage Analytics',
              description: 'Help us improve by sharing how you use the platform'
            },
            {
              key: 'allow_marketing',
              label: 'Marketing Communications',
              description: 'Receive emails about new features and updates'
            },
          ].map(setting => (
            <label
              key={setting.key}
              className="flex items-start gap-4 p-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition"
            >
              <input
                type="checkbox"
                checked={privacySettings[setting.key as keyof typeof privacySettings]}
                onChange={(e) => handlePrivacyChange(setting.key, e.target.checked)}
                disabled={saving}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white text-sm">
                  {setting.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {setting.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
