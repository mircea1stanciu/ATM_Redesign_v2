'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, User, Moon, Sun, Sparkles, ArrowLeft, Mail, MapPin, Briefcase, Edit2, Save, X, Lock, Eye, EyeOff, AlertCircle, CheckCircle, Shield } from 'lucide-react';
import ModelSelector from '@/components/ModelSelector';

interface UserData {
  id: number;
  role: string;
  username: string;
  email?: string;
  full_name?: string;
  organization?: {
    name: string;
  };
}

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'ai-models' | 'profile'>('profile');
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    full_name: '',
    email: '',
    username: '',
  });
  const [savedMessage, setSavedMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Password change states
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  // 2FA states
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [isSettingUp2FA, setIsSettingUp2FA] = useState(false);
  const [twoFAQRCode, setTwoFAQRCode] = useState<string>('');
  const [twoFASecret, setTwoFASecret] = useState<string>('');
  const [twoFAVerifyCode, setTwoFAVerifyCode] = useState('');
  const [twoFALoading, setTwoFALoading] = useState(false);
  
  // 2FA verification for profile/password changes
  const [showTwoFAVerification, setShowTwoFAVerification] = useState(false);
  const [twoFAVerificationCode, setTwoFAVerificationCode] = useState('');
  const [pendingAction, setPendingAction] = useState<'profile' | 'password' | null>(null);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const userData = JSON.parse(userStr);
        setUser(userData);
        setProfileData({
          full_name: userData.full_name || '',
          email: userData.email || '',
          username: userData.username || '',
        });
        
        // Set default tab based on user role
        const allowedRoles = ['super_admin', 'org_admin', 'community_lead'];
        if (!allowedRoles.includes(userData.role)) {
          // Regular users default to 'profile' tab
          setActiveTab('profile');
        } else {
          // Admins and community leads default to 'ai-models' tab
          setActiveTab('ai-models');
        }
      } catch (e) {
        router.push('/login');
        return;
      }
    } else {
      router.push('/login');
      return;
    }
    setLoading(false);
    fetchTwoFAStatus();
  }, [router]);

  const handleProfileUpdate = async () => {
    // If 2FA is not enabled, directly update the profile
    if (!twoFAEnabled) {
      try {
        setIsLoading(true);
        const token = localStorage.getItem('token');
        const response = await fetch('http://localhost:8002/api/auth/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            username: profileData.username,
            full_name: profileData.full_name,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          setErrorMessage(error.detail || 'Failed to update profile');
          setIsLoading(false);
          return;
        }

        const data = await response.json();
        
        const updatedUser: UserData = {
          id: user!.id,
          role: user!.role,
          email: user!.email,
          username: data.user.username,
          full_name: data.user.full_name,
          organization: user!.organization,
        };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        setUser(updatedUser);
        setIsEditingProfile(false);
        setSavedMessage('Profile updated successfully!');
        setErrorMessage('');
        setTimeout(() => setSavedMessage(''), 3000);
        setIsLoading(false);
      } catch (error) {
        setErrorMessage('Failed to update profile');
        setIsLoading(false);
      }
      return;
    }

    // Show 2FA verification dialog if 2FA is enabled
    setPendingAction('profile');
    setShowTwoFAVerification(true);
    setTwoFAVerificationCode('');
    setErrorMessage('');
  };

  const handleConfirmProfileUpdate = async () => {
    if (!twoFAVerificationCode || twoFAVerificationCode.length !== 6) {
      setErrorMessage('Please enter a valid 6-digit 2FA code');
      return;
    }

    if (user) {
      try {
        setIsLoading(true);
        const token = localStorage.getItem('token');
        const response = await fetch('http://localhost:8002/api/auth/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            username: profileData.username,
            full_name: profileData.full_name,
            two_fa_code: twoFAVerificationCode,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          setErrorMessage(error.detail || 'Failed to update profile');
          setIsLoading(false);
          return;
        }

        const data = await response.json();
        
        const updatedUser: UserData = {
          id: user.id,
          role: user.role,
          email: user.email,
          username: data.user.username,
          full_name: data.user.full_name,
          organization: user.organization,
        };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        setUser(updatedUser);
        setIsEditingProfile(false);
        setSavedMessage('Profile updated successfully!');
        setErrorMessage('');
        setShowTwoFAVerification(false);
        setPendingAction(null);
        setTwoFAVerificationCode('');
        setTimeout(() => setSavedMessage(''), 3000);
        setIsLoading(false);
      } catch (error) {
        setErrorMessage('Failed to update profile');
        setIsLoading(false);
      }
    }
  };

  const [isLoading, setIsLoading] = useState(false);

  const handleCancel = () => {
    if (user) {
      setProfileData({
        full_name: user.full_name || '',
        email: user.email || '',
        username: user.username || '',
      });
    }
    setIsEditingProfile(false);
    setShowTwoFAVerification(false);
    setPendingAction(null);
    setTwoFAVerificationCode('');
  };

  const handlePasswordChange = async () => {
    // Validate password fields first
    if (!passwordData.currentPassword || !passwordData.newPassword) {
      setErrorMessage('Please fill in all password fields');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setErrorMessage('New passwords do not match');
      return;
    }

    // If 2FA is not enabled, directly change the password
    if (!twoFAEnabled) {
      try {
        setIsLoading(true);
        const token = localStorage.getItem('token');
        const response = await fetch('http://localhost:8002/api/auth/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            current_password: passwordData.currentPassword,
            new_password: passwordData.newPassword,
          }),
        });

        if (response.ok) {
          setSavedMessage('Password changed successfully!');
          setPasswordData({
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
          });
          setIsChangingPassword(false);
          setErrorMessage('');
          setTimeout(() => setSavedMessage(''), 3000);
        } else {
          const data = await response.json();
          setErrorMessage(data.detail || 'Failed to change password');
        }
      } catch (error) {
        setErrorMessage('Error changing password. Please try again.');
        console.error('Password change error:', error);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Show 2FA verification dialog if 2FA is enabled
    setPendingAction('password');
    setShowTwoFAVerification(true);
    setTwoFAVerificationCode('');
    setErrorMessage('');
  };

  const handleConfirmPasswordChange = async () => {
    setErrorMessage('');
    
    // Validate 2FA code
    if (!twoFAVerificationCode) {
      setErrorMessage('2FA code is required');
      return;
    }
    if (twoFAVerificationCode.length !== 6 || !/^\d+$/.test(twoFAVerificationCode)) {
      setErrorMessage('2FA code must be 6 digits');
      return;
    }

    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          current_password: passwordData.currentPassword,
          new_password: passwordData.newPassword,
          two_fa_code: twoFAVerificationCode,
        }),
      });

      if (response.ok) {
        setSavedMessage('Password changed successfully!');
        setPasswordData({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        setShowTwoFAVerification(false);
        setTwoFAVerificationCode('');
        setIsChangingPassword(false);
        setTimeout(() => setSavedMessage(''), 3000);
      } else {
        const data = await response.json();
        setErrorMessage(data.detail || 'Failed to change password');
      }
    } catch (error) {
      setErrorMessage('Error changing password. Please try again.');
      console.error('Password change error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelPassword = () => {
    setPasswordData({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
    setIsChangingPassword(false);
    setErrorMessage('');
  };

  const handle2FASetup = async () => {
    try {
      setTwoFALoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/auth/2fa/setup', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        setErrorMessage(error.detail || 'Failed to setup 2FA');
        setTwoFALoading(false);
        return;
      }

      const data = await response.json();
      setTwoFAQRCode(data.qr_code);
      setTwoFASecret(data.secret);
      setIsSettingUp2FA(true);
      setTwoFAVerifyCode('');
      setErrorMessage('');
      setTwoFALoading(false);
    } catch (error) {
      setErrorMessage('Error setting up 2FA');
      setTwoFALoading(false);
    }
  };

  const handle2FAVerify = async () => {
    if (!twoFAVerifyCode || twoFAVerifyCode.length !== 6) {
      setErrorMessage('Please enter a valid 6-digit code');
      return;
    }

    try {
      setTwoFALoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/auth/2fa/enable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          verify_code: twoFAVerifyCode,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        setErrorMessage(error.detail || 'Failed to verify 2FA code');
        setTwoFALoading(false);
        return;
      }

      setTwoFAEnabled(true);
      setIsSettingUp2FA(false);
      setTwoFAQRCode('');
      setTwoFASecret('');
      setTwoFAVerifyCode('');
      setSavedMessage('2FA enabled successfully!');
      setErrorMessage('');
      setTimeout(() => setSavedMessage(''), 3000);
      setTwoFALoading(false);
    } catch (error) {
      setErrorMessage('Error verifying 2FA code');
      setTwoFALoading(false);
    }
  };

  const handle2FADisable = async () => {
    if (!confirm('Are you sure you want to disable 2FA?')) return;

    try {
      setTwoFALoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/auth/2fa/disable', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        setErrorMessage(error.detail || 'Failed to disable 2FA');
        setTwoFALoading(false);
        return;
      }

      setTwoFAEnabled(false);
      setSavedMessage('2FA disabled successfully');
      setErrorMessage('');
      setTimeout(() => setSavedMessage(''), 3000);
      setTwoFALoading(false);
    } catch (error) {
      setErrorMessage('Error disabling 2FA');
      setTwoFALoading(false);
    }
  };

  const fetchTwoFAStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/auth/2fa/status', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTwoFAEnabled(data.enabled);
      }
    } catch (error) {
      console.error('Error fetching 2FA status:', error);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back</span>
              </button>
              <div className="flex items-center gap-3">
                <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <nav className="space-y-1">
              {/* AI Models Tab - Only for super_admin, org_admin, community_lead */}
              {user && ['super_admin', 'org_admin', 'community_lead'].includes(user.role) && (
                <button
                  onClick={() => setActiveTab('ai-models')}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'ai-models'
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Sparkles className="w-5 h-5" />
                  AI Models
                </button>
              )}
              <button
                onClick={() => setActiveTab('profile')}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'profile'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <User className="w-5 h-5" />
                Profile
              </button>
            </nav>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
              {activeTab === 'ai-models' && (
                <div>
                  <ModelSelector />
                </div>
              )}

              {activeTab === 'profile' && (
                <div className="space-y-6">
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Profile Information
                      </h3>
                      {!isEditingProfile && twoFAEnabled && (
                        <button
                          onClick={() => setIsEditingProfile(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        >
                          <Edit2 size={16} />
                          Edit Profile
                        </button>
                      )}
                      {!isEditingProfile && !twoFAEnabled && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed" title="Enable 2FA to edit profile">
                          <Edit2 size={16} />
                          Edit Profile
                        </div>
                      )}
                    </div>

                    {savedMessage && (
                      <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg">
                        ✓ {savedMessage}
                      </div>
                    )}

                    {!twoFAEnabled && !isEditingProfile && (
                      <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-start gap-3">
                        <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-amber-900 dark:text-amber-200">
                            Two-Factor Authentication Required
                          </p>
                          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                            You need to enable 2FA to edit your profile information.
                          </p>
                        </div>
                      </div>
                    )}

                    {errorMessage && (
                      <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg flex items-center gap-2">
                        <AlertCircle size={18} />
                        {errorMessage}
                      </div>
                    )}

                    {isEditingProfile ? (
                      <div className="space-y-4">
                        {/* Full Name */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Full Name
                          </label>
                          <input
                            type="text"
                            value={profileData.full_name}
                            onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter your full name"
                          />
                        </div>

                        {/* Email */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Email Address
                          </label>
                          <input
                            type="email"
                            value={profileData.email}
                            disabled
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white cursor-not-allowed"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Email address cannot be changed</p>
                        </div>

                        {/* Username */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Username
                          </label>
                          <input
                            type="text"
                            value={profileData.username}
                            onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter your username"
                          />
                        </div>

                        {/* Role (Read-only) */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Role
                          </label>
                          <input
                            type="text"
                            value={user?.role?.replace('_', ' ').toUpperCase() || ''}
                            disabled
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white cursor-not-allowed"
                          />
                        </div>

                        {/* Organization (Read-only) */}
                        {user?.organization && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Organization
                            </label>
                            <input
                              type="text"
                              value={user.organization.name || ''}
                              disabled
                              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white cursor-not-allowed"
                            />
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <button
                            onClick={handleProfileUpdate}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                          >
                            <Save size={16} />
                            Save Changes
                          </button>
                          <button
                            onClick={handleCancel}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded-lg transition-colors"
                          >
                            <X size={16} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Display Profile Info */}
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                              {user?.full_name?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
                            </div>
                            <div className="flex-1">
                              <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                                {user?.full_name || 'User Profile'}
                              </h4>
                              <div className="space-y-3">
                                <div className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
                                  <Mail size={18} className="text-gray-500" />
                                  <div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">Email</p>
                                    <p className="font-medium">{user?.email || 'Not provided'}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
                                  <Briefcase size={18} className="text-gray-500" />
                                  <div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">Role</p>
                                    <p className="font-medium">{user?.role?.replace('_', ' ').toUpperCase()}</p>
                                  </div>
                                </div>
                                {user?.organization && (
                                  <div className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
                                    <MapPin size={18} className="text-gray-500" />
                                    <div>
                                      <p className="text-sm text-gray-600 dark:text-gray-400">Organization</p>
                                      <p className="font-medium">{user.organization.name}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Password Change Section */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Lock size={20} className="text-blue-600 dark:text-blue-400" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          Change Password
                        </h3>
                      </div>
                      {!isChangingPassword && twoFAEnabled && (
                        <button
                          onClick={() => setIsChangingPassword(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        >
                          <Edit2 size={16} />
                          Change Password
                        </button>
                      )}
                      {!isChangingPassword && !twoFAEnabled && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed" title="Enable 2FA to change password">
                          <Edit2 size={16} />
                          Change Password
                        </div>
                      )}
                    </div>

                    {!twoFAEnabled && !isChangingPassword && (
                      <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-start gap-3">
                        <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-amber-900 dark:text-amber-200">
                            Two-Factor Authentication Required
                          </p>
                          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                            You need to enable 2FA before you can change your password.
                          </p>
                        </div>
                      </div>
                    )}

                    {errorMessage && (
                      <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg flex items-start gap-2">
                        <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                        <span>{errorMessage}</span>
                      </div>
                    )}

                    {isChangingPassword ? (
                      <div className="space-y-4">
                        {/* Current Password */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Current Password
                          </label>
                          <div className="relative">
                            <input
                              type={showPasswords.current ? 'text' : 'password'}
                              value={passwordData.currentPassword}
                              onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                              className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Enter current password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              {showPasswords.current ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>

                        {/* New Password */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            New Password
                          </label>
                          <div className="relative">
                            <input
                              type={showPasswords.new ? 'text' : 'password'}
                              value={passwordData.newPassword}
                              onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                              className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Enter new password (minimum 6 characters)"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              {showPasswords.new ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>

                        {/* Confirm Password */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Confirm New Password
                          </label>
                          <div className="relative">
                            <input
                              type={showPasswords.confirm ? 'text' : 'password'}
                              value={passwordData.confirmPassword}
                              onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                              className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Confirm new password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              {showPasswords.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <button
                            onClick={handlePasswordChange}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                          >
                            <Save size={16} />
                            Update Password
                          </button>
                          <button
                            onClick={handleCancelPassword}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded-lg transition-colors"
                          >
                            <X size={16} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <div className="flex items-start gap-3">
                          <CheckCircle size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-blue-900 dark:text-blue-200 font-medium">Secure your account</p>
                            <p className="text-blue-800 dark:text-blue-300 text-sm mt-1">
                              Click "Change Password" to update your password and keep your account secure.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2FA Verification Modal */}
                  {showTwoFAVerification && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md w-full p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <Shield size={24} className="text-purple-600 dark:text-purple-400" />
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            Verify Your Identity
                          </h3>
                        </div>
                        <p className="text-gray-600 dark:text-gray-400 mb-4">
                          {pendingAction === 'profile'
                            ? 'Enter your 2FA code to save profile changes:'
                            : 'Enter your 2FA code to change your password:'}
                        </p>

                        {/* 2FA Code Input */}
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            6-Digit Authentication Code
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={twoFAVerificationCode}
                            onChange={(e) => setTwoFAVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="w-full px-4 py-2 border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center text-2xl font-mono tracking-widest focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Enter the code from your authenticator app
                          </p>
                        </div>

                        {/* Error Message */}
                        {errorMessage && (
                          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg">
                            <p className="text-red-700 dark:text-red-300 text-sm">{errorMessage}</p>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                          <button
                            onClick={() => {
                              if (pendingAction === 'profile') {
                                handleConfirmProfileUpdate();
                              } else {
                                handleConfirmPasswordChange();
                              }
                            }}
                            disabled={isLoading || twoFAVerificationCode.length !== 6}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                          >
                            {isLoading ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Verifying...
                              </>
                            ) : (
                              <>
                                <CheckCircle size={16} />
                                Verify & Continue
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setShowTwoFAVerification(false);
                              setTwoFAVerificationCode('');
                              setErrorMessage('');
                              setPendingAction(null);
                            }}
                            disabled={isLoading}
                            className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-300 disabled:cursor-not-allowed text-gray-900 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Two-Factor Authentication Section */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Shield size={20} className="text-purple-600 dark:text-purple-400" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          Two-Factor Authentication
                        </h3>
                      </div>
                      {!isSettingUp2FA && (
                        <button
                          onClick={twoFAEnabled ? handle2FADisable : handle2FASetup}
                          disabled={twoFALoading}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                            twoFAEnabled
                              ? 'bg-red-600 hover:bg-red-700 text-white'
                              : 'bg-purple-600 hover:bg-purple-700 text-white'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {twoFALoading ? 'Processing...' : twoFAEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                        </button>
                      )}
                    </div>

                    {isSettingUp2FA ? (
                      <div className="space-y-4">
                        {twoFAQRCode && (
                          <div className="flex flex-col items-center gap-4">
                            <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                              <img
                                src={`data:image/png;base64,${twoFAQRCode}`}
                                alt="2FA QR Code"
                                className="w-56 h-56"
                              />
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                              Scan this QR code with your authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.)
                            </p>
                            {twoFASecret && (
                              <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg w-full">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Or enter this code manually:</p>
                                <p className="font-mono text-center break-all text-gray-900 dark:text-white">
                                  {twoFASecret}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Verification Code Input */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Enter 6-digit code from your authenticator app
                          </label>
                          <input
                            type="text"
                            maxLength={6}
                            value={twoFAVerifyCode}
                            onChange={(e) => setTwoFAVerifyCode(e.target.value.replace(/\D/g, ''))}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent text-center text-2xl tracking-widest"
                            placeholder="000000"
                          />
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <button
                            onClick={handle2FAVerify}
                            disabled={twoFALoading || twoFAVerifyCode.length !== 6}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <CheckCircle size={16} />
                            Verify & Enable
                          </button>
                          <button
                            onClick={() => {
                              setIsSettingUp2FA(false);
                              setTwoFAQRCode('');
                              setTwoFASecret('');
                              setTwoFAVerifyCode('');
                              setErrorMessage('');
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded-lg transition-colors"
                          >
                            <X size={16} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <div className="flex items-start gap-3">
                          <Shield size={20} className="text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-purple-900 dark:text-purple-200 font-medium">
                              {twoFAEnabled ? '✓ 2FA is enabled' : 'Enhance your security'}
                            </p>
                            <p className="text-purple-800 dark:text-purple-300 text-sm mt-1">
                              {twoFAEnabled
                                ? 'Your account is protected with two-factor authentication. You can disable it if needed.'
                                : 'Enable two-factor authentication to add an extra layer of security to your account.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
