'use client';

import { useState, useEffect } from 'react';
import AIDeliveryFlow from './AIDeliveryFlow';
import { Sun, Moon } from 'lucide-react';

interface CommunityDashboardProps {
  communityId: string;
  communityName: string;
  communityIcon: string;
  communityColor: string;
  capabilities: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
}

export default function CommunityDashboard({
  communityId,
  communityName,
  communityIcon,
  communityColor,
  capabilities
}: CommunityDashboardProps) {
  const [user, setUser] = useState<any>(null);
  const [isDark, setIsDark] = useState(false);
  const [stats, setStats] = useState({
    totalChats: 0,
    thisWeek: 0,
    activeNow: 0
  });
  const [activeTab, setActiveTab] = useState<'overview' | 'delivery'>('overview');

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }

    // Initialize dark mode from localStorage
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);

    // TODO: Fetch real stats from API
    setStats({
      totalChats: 24,
      thisWeek: 8,
      activeNow: 1
    });
  }, []);

  const toggleDarkMode = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', newTheme);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-2 sm:p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        {/* Welcome Header */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-6">
          <div className="flex items-center justify-between gap-3 sm:gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <div className={`w-12 sm:w-16 h-12 sm:h-16 rounded-full flex items-center justify-center text-xl sm:text-3xl flex-shrink-0 ${communityColor} text-white`}>
                {communityIcon}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
                  {communityName} Dashboard
                </h1>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
                  Welcome back, {user?.full_name || user?.username || 'User'}! 👋
                </p>
              </div>
            </div>
            <button
              onClick={toggleDarkMode}
              className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all duration-200 flex-shrink-0"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 mt-3 sm:mt-4 border-t border-gray-200 dark:border-gray-700 pt-3 sm:pt-4 flex-wrap">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium transition-colors text-xs sm:text-sm ${
                activeTab === 'overview'
                  ? `${communityColor} text-white`
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              📊 Overview
            </button>
            <button
              onClick={() => setActiveTab('delivery')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium transition-colors flex items-center gap-1 sm:gap-2 text-xs sm:text-sm flex-wrap ${
                activeTab === 'delivery'
                  ? `${communityColor} text-white`
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              🚀 AI Delivery Flow
              <span className="px-1.5 sm:px-2 py-0.5 bg-purple-500 text-white text-xs rounded-full whitespace-nowrap">NEW</span>
            </button>
          </div>
        </div>

        {/* Conditional Content */}
        {activeTab === 'overview' ? (
          <>
        {/* Stats Grid */}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 truncate">Total Conversations</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white truncate">{stats.totalChats}</p>
              </div>
              <div className="w-10 sm:w-12 h-10 sm:h-12 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
                💬
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 truncate">This Week</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white truncate">{stats.thisWeek}</p>
              </div>
              <div className="w-10 sm:w-12 h-10 sm:h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
                📊
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 truncate">Active Sessions</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white truncate">{stats.activeNow}</p>
              </div>
              <div className="w-10 sm:w-12 h-10 sm:h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
                ⚡
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">
            🚀 Quick Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            {capabilities.slice(0, 6).map((capability, index) => (
              <button
                key={index}
                className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-left"
                onClick={() => {
                  // This will be handled by parent to open chat with pre-filled query
                  const event = new CustomEvent('openChatWithQuery', {
                    detail: { query: `Help me with ${capability.title.toLowerCase()}` }
                  });
                  window.dispatchEvent(event);
                }}
              >
                <span className="text-xl sm:text-2xl flex-shrink-0">{capability.icon}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                    {capability.title}
                  </h3>
                  <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 truncate">
                    {capability.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">
            📜 Recent Activity
          </h2>
          <div className="space-y-2 sm:space-y-3">
            {[
              { action: 'Started conversation', time: '2 hours ago', icon: '💬' },
              { action: 'Completed task', time: 'Yesterday', icon: '✅' },
              { action: 'Asked question', time: '2 days ago', icon: '❓' },
              { action: 'Received help', time: '3 days ago', icon: '🎯' },
            ].map((activity, index) => (
              <div
                key={index}
                className="flex items-center gap-2 sm:gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <span className="text-lg sm:text-xl flex-shrink-0">{activity.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
                    {activity.action}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {activity.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Community Resources */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">
            📚 Resources & Guides
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            <a
              href="#"
              className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <span className="text-xl sm:text-2xl flex-shrink-0">📖</span>
              <div className="min-w-0">
                <h3 className="font-medium text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                  Getting Started Guide
                </h3>
                <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 truncate">
                  Learn the basics
                </p>
              </div>
            </a>
            <a
              href="#"
              className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <span className="text-xl sm:text-2xl flex-shrink-0">🎓</span>
              <div className="min-w-0">
                <h3 className="font-medium text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                  Best Practices
                </h3>
                <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 truncate">
                  Tips and tricks
                </p>
              </div>
            </a>
            <a
              href="#"
              className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <span className="text-xl sm:text-2xl flex-shrink-0">💡</span>
              <div className="min-w-0">
                <h3 className="font-medium text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                  Example Projects
                </h3>
                <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 truncate">
                  See it in action
                </p>
              </div>
            </a>
            <a
              href="#"
              className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <span className="text-xl sm:text-2xl flex-shrink-0">❓</span>
              <div className="min-w-0">
                <h3 className="font-medium text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                  FAQ
                </h3>
                <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 truncate">
                  Common questions
                </p>
              </div>
            </a>
          </div>
        </div>
        </>
        ) : (
          <AIDeliveryFlow
            communityId={communityId}
            communityName={communityName}
            communityColor={communityColor}
          />
        )}
      </div>
    </div>
  );
}
