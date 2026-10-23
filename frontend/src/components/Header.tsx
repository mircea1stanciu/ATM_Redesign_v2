'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Moon, Sun, LogOut, Trash2, Lightbulb, Settings, User, Sparkles } from 'lucide-react'

const communities = [
  { id: 'qa', name: 'QA Engineers', icon: '🎯', agent: 'QualityGPT', color: 'bg-blue-500' },
  { id: 'backend', name: 'Backend Developers', icon: '🔧', agent: 'BackendGPT', color: 'bg-green-500' },
  { id: 'frontend', name: 'Frontend Developers', icon: '🎨', agent: 'FrontendGPT', color: 'bg-purple-500' },
  { id: 'design', name: 'UI/UX Designers', icon: '✨', agent: 'DesignGPT', color: 'bg-pink-500' },
  { id: 'product', name: 'Product Managers', icon: '📊', agent: 'ProductGPT', color: 'bg-orange-500' },
  { id: 'devops', name: 'DevOps Engineers', icon: '🔐', agent: 'OpsGPT', color: 'bg-red-500' },
  { id: 'docs', name: 'Technical Writers', icon: '📝', agent: 'DocsGPT', color: 'bg-indigo-500' },
]

interface HeaderProps {
  currentCommunity?: string
  onClear?: () => void
  onShowExamples?: () => void
  onLogout?: () => void
  activeSection?: string
  onSectionChange?: (section: string) => void
}

export default function Header({ currentCommunity, onClear, onShowExamples, onLogout, activeSection, onSectionChange }: HeaderProps) {
  const [isDark, setIsDark] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userRole, setUserRole] = useState<string>('')
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Check theme preference
    const savedTheme = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark)
    
    setIsDark(shouldBeDark)
    document.documentElement.classList.toggle('dark', shouldBeDark)

    // Check authentication status
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr)
        setIsAuthenticated(true)
        setUserRole(user.role || '')
      } catch (e) {
        // Invalid user data, clear storage
        localStorage.removeItem('token')
        localStorage.removeItem('user')
      }
    }
  }, [])

  const toggleTheme = () => {
    const newTheme = !isDark
    setIsDark(newTheme)
    localStorage.setItem('theme', newTheme ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', newTheme)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('userRole')
    localStorage.removeItem('organizationId')
    setIsAuthenticated(false)
    setUserRole('')
    if (onLogout) {
      onLogout()
    } else {
      router.push('/')
    }
  }

  const community = communities.find(c => c.id === currentCommunity)

  return (
    <nav className="sticky top-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Brand */}
          <div className="flex items-center space-x-4">
            <Link href="/" className="flex items-center space-x-3 group">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
                <span className="text-white font-bold text-sm">UW</span>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200">
                  UnifiedWork
                </h1>
                {community ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
                    {community.icon} {community.name} → {community.agent}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
                    AI-Powered Community Platform
                  </p>
                )}
              </div>
            </Link>
          </div>

          {/* Navigation Links (Hidden on mobile) */}
          {!currentCommunity && (pathname === '/' || pathname === '/dashboard') && (
            <div className="hidden md:flex items-center space-x-2">
              {pathname === '/' ? (
                <>
                  <button
                    onClick={() => onSectionChange?.('hero')}
                    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      activeSection === 'hero' || !activeSection
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    Home
                  </button>
                  <button
                    onClick={() => onSectionChange?.('communities')}
                    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      activeSection === 'communities'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    Explore Communities
                  </button>
                  <button
                    onClick={() => onSectionChange?.('about')}
                    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      activeSection === 'about'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    Learn More
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/"
                    className="px-4 py-2 rounded-lg font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
                  >
                    Home
                  </Link>
                  <button
                    className="px-4 py-2 rounded-lg font-medium bg-blue-600 text-white shadow-md transition-all duration-200"
                    disabled
                  >
                    Dashboard
                  </button>
                  <Link
                    href="/#about"
                    className="px-4 py-2 rounded-lg font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
                  >
                    Learn More
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            {/* Clear Button (conditional) */}
            {onClear && (
              <button
                onClick={onClear}
                className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all duration-200"
                title="Clear conversation"
              >
                <Trash2 size={16} />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}

            {/* Examples Button (conditional) */}
            {onShowExamples && (
              <button
                onClick={onShowExamples}
                className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all duration-200"
                title="View examples"
              >
                <Lightbulb size={16} />
                <span className="hidden sm:inline">Examples</span>
              </button>
            )}

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all duration-200"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Settings Link - For all authenticated users */}
            {isAuthenticated && (
              <Link
                href="/settings"
                className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all duration-200 relative"
                title="Settings & Preferences"
              >
                <Settings size={18} />
                {['super_admin', 'org_admin', 'community_lead'].includes(userRole) && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full"></span>
                )}
              </Link>
            )}

            {/* Authentication Buttons */}
            {isAuthenticated ? (
              <div className="flex items-center space-x-2">
                {/* Dashboard Link - Role Based */}
                {userRole === 'super_admin' && (
                  <Link
                    href="/admin"
                    className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 rounded-lg shadow-sm transition-all duration-200"
                    title="Super Admin Dashboard"
                  >
                    <Settings size={16} />
                    <span className="hidden sm:inline">Super Admin</span>
                    <span className="sm:hidden">Admin</span>
                  </Link>
                )}
                
                {userRole === 'org_admin' && (
                  <Link
                    href="/admin"
                    className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg shadow-sm transition-all duration-200"
                    title="Organization Admin Dashboard"
                  >
                    <Settings size={16} />
                    <span className="hidden sm:inline">Admin Panel</span>
                    <span className="sm:hidden">Admin</span>
                  </Link>
                )}

                {userRole === 'community_lead' && (
                  <Link
                    href="/dashboard"
                    className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-lg shadow-sm transition-all duration-200"
                    title="Community Lead Dashboard"
                  >
                    <User size={16} />
                    <span className="hidden sm:inline">My Dashboard</span>
                    <span className="sm:hidden">Dashboard</span>
                  </Link>
                )}

                {userRole === 'user' && (
                  <Link
                    href="/dashboard"
                    className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 rounded-lg shadow-sm transition-all duration-200"
                    title="My Dashboard"
                  >
                    <User size={16} />
                    <span className="hidden sm:inline">My Dashboard</span>
                    <span className="sm:hidden">Dashboard</span>
                  </Link>
                )}

                {/* Logout Button */}
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all duration-200"
                  title="Logout"
                >
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link
                  href="/login"
                  className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 border border-blue-600 dark:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all duration-200"
                >
                  <User size={16} />
                  <span className="hidden sm:inline">Login</span>
                </Link>
                <Link
                  href="/register"
                  className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-all duration-200"
                >
                  <span className="hidden sm:inline">Get Started</span>
                  <span className="sm:hidden">Sign Up</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
