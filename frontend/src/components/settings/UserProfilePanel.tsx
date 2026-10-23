import { useEffect, useState, useRef } from 'react'
import {
  AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Mail, Lock, User, Upload, Trash2, LogOut
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { apiService } from '@/services/api'

interface FormState {
  fullName: string
  email: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
  twoFaCode: string
}

interface PasswordVisibility {
  current: boolean
  new: boolean
  confirm: boolean
}

export function UserProfilePanel() {
  const user = useAppStore(s => s.user)
  const setUser = useAppStore(s => s.setUser)
  const logout = useAppStore(s => s.logout)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<FormState>({
    fullName: user?.full_name || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    twoFaCode: '',
  })

  const [passwordVisibility, setPasswordVisibility] = useState<PasswordVisibility>({
    current: false,
    new: false,
    confirm: false,
  })

  const [profilePicture, setProfilePicture] = useState<File | null>(null)
  const [profilePicturePreview, setProfilePicturePreview] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingPicture, setSavingPicture] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('')
  const [deleteConfirmTwoFa, setDeleteConfirmTwoFa] = useState('')

  useEffect(() => {
    setForm(prev => ({
      ...prev,
      fullName: user?.full_name || '',
      email: user?.email || '',
    }))
  }, [user])

  const handleProfilePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Profile picture must be less than 5MB')
      return
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('File must be an image')
      return
    }

    setProfilePicture(file)

    // Create preview
    const reader = new FileReader()
    reader.onload = (event) => {
      setProfilePicturePreview(event.target?.result as string)
    }
    reader.readAsDataURL(file)
    setError(null)
  }

  const handleUploadProfilePicture = async () => {
    if (!profilePicture) return

    setSavingPicture(true)
    setError(null)
    try {
      await apiService.uploadProfilePicture(profilePicture)
      setProfilePicture(null)
      setProfilePicturePreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSaveMsg('Profile picture uploaded successfully')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSavingPicture(false)
    }
  }

  const handleDeleteProfilePicture = async () => {
    setSavingPicture(true)
    setError(null)
    try {
      await apiService.deleteProfilePicture()
      setSaveMsg('Profile picture removed successfully')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSavingPicture(false)
    }
  }

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaveMsg(null)

    try {
      const hasChanges = form.fullName !== (user?.full_name || '') || form.email !== (user?.email || '')

      if (!hasChanges) {
        setError('No changes to save')
        setSaving(false)
        return
      }

      await apiService.updateProfile(
        form.fullName || undefined,
        form.email !== user?.email ? form.email : undefined,
        form.twoFaCode || undefined
      )

      setUser({
        ...user!,
        full_name: form.fullName,
        email: form.email,
      })

      setForm(prev => ({ ...prev, twoFaCode: '' }))
      setSaveMsg('Profile updated successfully')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordMsg(null)
    setError(null)

    if (!form.currentPassword || !form.newPassword) {
      setError('Current password and new password are required')
      return
    }

    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match')
      return
    }

    if (form.newPassword.length < 8) {
      setError('New password must be at least 8 characters long')
      return
    }

    setSavingPassword(true)

    try {
      await apiService.changePassword(
        form.currentPassword,
        form.newPassword,
        form.twoFaCode || undefined
      )

      setForm(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        twoFaCode: '',
      }))

      setPasswordMsg('Password changed successfully')
      setTimeout(() => setPasswordMsg(null), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setSavingPassword(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deleteConfirmPassword) {
      setError('Password is required to delete account')
      return
    }

    setDeletingAccount(true)
    setError(null)

    try {
      await apiService.deleteAccount(deleteConfirmPassword, deleteConfirmTwoFa || undefined)
      // Account deleted, logout
      logout()
    } catch (err) {
      setError(apiService.errorMessage(err))
      setDeletingAccount(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile Picture Section */}
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
            <User size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Profile Picture</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Upload a profile photo (max 5MB)</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {profilePicturePreview && (
            <div className="flex justify-center mb-4">
              <img
                src={profilePicturePreview}
                alt="Preview"
                className="h-32 w-32 rounded-full object-cover border-2 border-blue-200 dark:border-blue-800"
              />
            </div>
          )}

          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleProfilePictureChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={savingPicture}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingPicture ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              Choose Photo
            </button>

            {profilePicture && (
              <button
                type="button"
                onClick={handleUploadProfilePicture}
                disabled={savingPicture}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-700 dark:text-green-300 px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingPicture ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                Upload
              </button>
            )}

            <button
              type="button"
              onClick={handleDeleteProfilePicture}
              disabled={savingPicture}
              className="flex items-center justify-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Personal Information Section */}
      <form onSubmit={handleUpdateProfile} className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
            <User size={20} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Personal Information</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Update your name and email</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Full Name</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm(prev => ({ ...prev, fullName: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              placeholder="Your full name"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Mail size={16} /> Email Address
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              placeholder="your@email.com"
            />
          </div>

          {user?.two_fa_enabled && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">2FA Code</label>
              <input
                type="text"
                value={form.twoFaCode}
                onChange={(e) => setForm(prev => ({ ...prev, twoFaCode: e.target.value }))}
                maxLength={6}
                placeholder="000000"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
              <AlertCircle size={15} className="shrink-0" /> {error}
            </div>
          )}

          {saveMsg && !error && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={15} className="shrink-0" /> {saveMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Saving...
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> Save Changes
              </>
            )}
          </button>
        </div>
      </form>

      {/* Change Password Section */}
      <form onSubmit={handleChangePassword} className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-gray-800/90 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
            <Lock size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Change Password</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Update your account password</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Current Password</label>
            <div className="relative">
              <input
                type={passwordVisibility.current ? 'text' : 'password'}
                value={form.currentPassword}
                onChange={(e) => setForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                placeholder="Enter current password"
              />
              <button
                type="button"
                onClick={() => setPasswordVisibility(prev => ({ ...prev, current: !prev.current }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {passwordVisibility.current ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">New Password</label>
            <div className="relative">
              <input
                type={passwordVisibility.new ? 'text' : 'password'}
                value={form.newPassword}
                onChange={(e) => setForm(prev => ({ ...prev, newPassword: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                placeholder="Enter new password (min 8 characters)"
              />
              <button
                type="button"
                onClick={() => setPasswordVisibility(prev => ({ ...prev, new: !prev.new }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {passwordVisibility.new ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Confirm New Password</label>
            <div className="relative">
              <input
                type={passwordVisibility.confirm ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={(e) => setForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
                placeholder="Confirm new password"
              />
              <button
                type="button"
                onClick={() => setPasswordVisibility(prev => ({ ...prev, confirm: !prev.confirm }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {passwordVisibility.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {user?.two_fa_enabled && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">2FA Code</label>
              <input
                type="text"
                value={form.twoFaCode}
                onChange={(e) => setForm(prev => ({ ...prev, twoFaCode: e.target.value }))}
                maxLength={6}
                placeholder="000000"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>
          )}

          {passwordMsg && !error && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={15} className="shrink-0" /> {passwordMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={savingPassword}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingPassword ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Updating...
              </>
            ) : (
              <>
                <Lock size={16} /> Change Password
              </>
            )}
          </button>
        </div>
      </form>

      {/* Delete Account Section */}
      <div className="rounded-2xl border border-red-200/80 dark:border-red-800/70 bg-red-50 dark:bg-red-900/10 shadow-soft overflow-hidden">
        <div className="flex items-center gap-4 border-b border-red-200 dark:border-red-800 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
            <Trash2 size={20} className="text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900 dark:text-white">Delete Account</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Permanently delete your account and all associated data</p>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
            className="rounded-lg bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 px-4 py-2 text-sm font-medium transition"
          >
            {showDeleteConfirm ? 'Cancel' : 'Delete Account'}
          </button>
        </div>

        {showDeleteConfirm && (
          <div className="p-6 space-y-4 border-t border-red-200 dark:border-red-800">
            <div className="rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <p className="font-semibold mb-2">Warning: This action cannot be undone</p>
              <p>Deleting your account will:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                <li>Permanently delete your account</li>
                <li>Remove all your data from our servers</li>
                <li>Cancel any active subscriptions</li>
              </ul>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Confirm Password</label>
              <input
                type="password"
                value={deleteConfirmPassword}
                onChange={(e) => setDeleteConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 transition"
                placeholder="Enter your password to confirm"
              />
            </div>

            {user?.two_fa_enabled && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">2FA Code</label>
                <input
                  type="text"
                  value={deleteConfirmTwoFa}
                  onChange={(e) => setDeleteConfirmTwoFa(e.target.value)}
                  maxLength={6}
                  placeholder="000000"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 transition"
                />
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                <AlertCircle size={15} className="shrink-0" /> {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setDeleteConfirmPassword('')
                  setDeleteConfirmTwoFa('')
                  setError(null)
                }}
                className="flex-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2.5 text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deletingAccount || !deleteConfirmPassword}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingAccount ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Deleting...
                  </>
                ) : (
                  <>
                    <LogOut size={16} /> Permanently Delete
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
