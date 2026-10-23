'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';
import { MessageSquare, Clock, TrendingUp, Users } from 'lucide-react';
import OfficeManagement from '@/components/OfficeManagement';

interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  assigned_communities?: string[];
  organization?: {
    id: number;
    name: string;
    slug: string;
    subscription_plan: string;
  };
}

const communities = [
  { id: 'qa', name: 'QA Engineers', icon: '🎯', agent: 'QualityGPT', color: 'bg-blue-500', description: 'Test automation & quality assurance' },
  { id: 'backend', name: 'Backend Developers', icon: '🔧', agent: 'BackendGPT', color: 'bg-green-500', description: 'APIs, databases, and server-side logic' },
  { id: 'frontend', name: 'Frontend Developers', icon: '🎨', agent: 'FrontendGPT', color: 'bg-purple-500', description: 'UI development with React, Vue, Angular' },
  { id: 'design', name: 'UI/UX Designers', icon: '✨', agent: 'DesignGPT', color: 'bg-pink-500', description: 'Design systems and user experience' },
  { id: 'product', name: 'Product Managers', icon: '📊', agent: 'ProductGPT', color: 'bg-orange-500', description: 'Product strategy and roadmaps' },
  { id: 'devops', name: 'DevOps Engineers', icon: '🔐', agent: 'OpsGPT', color: 'bg-red-500', description: 'CI/CD, infrastructure, and deployment' },
  { id: 'analyst', name: 'Business System Analysts', icon: '�', agent: 'AnalystGPT', color: 'bg-indigo-500', description: 'Requirements analysis and process optimization' },
];

export default function UserDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
      router.push('/login');
      return;
    }

    try {
      const userData = JSON.parse(userStr);
      setUser(userData);
    } catch (e) {
      router.push('/login');
      return;
    }

    setLoading(false);
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4 md:py-6 lg:py-8">
        {/* Welcome Section */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg sm:rounded-xl lg:rounded-2xl p-3 sm:p-4 md:p-6 lg:p-8 mb-3 sm:mb-4 md:mb-6 lg:mb-8 text-white shadow-xl">
          <div className="flex flex-col sm:flex-row items-center sm:items-start sm:justify-between gap-3 sm:gap-4">
            <div className="text-center sm:text-left w-full sm:w-auto">
              <h1 className="text-base sm:text-lg md:text-xl lg:text-2xl font-bold mb-1 sm:mb-2">
                Welcome back, {user.full_name || user.username}! 👋
              </h1>
              <p className="text-blue-100 text-[10px] sm:text-xs md:text-sm lg:text-base">
                {user.organization ? `${user.organization.name} • ` : ''}Ready to explore your communities
              </p>
            </div>
            <div className="hidden sm:block flex-shrink-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 xl:w-20 xl:h-20 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                <span className="text-xl sm:text-2xl md:text-2xl lg:text-3xl xl:text-4xl">🚀</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4 lg:gap-6 mb-3 sm:mb-4 md:mb-6 lg:mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-5 lg:p-6 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 lg:w-7 lg:h-7 text-blue-600" />
              <span className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white">
                {user.role === 'org_admin' || user.role === 'super_admin' 
                  ? communities.length 
                  : user.assigned_communities?.length || 0}
              </span>
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs md:text-sm">Communities</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-5 lg:p-6 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 lg:w-7 lg:h-7 text-green-600" />
              <span className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white">24/7</span>
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs md:text-sm">AI Support</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-5 lg:p-6 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 lg:w-7 lg:h-7 text-purple-600" />
              <span className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white">∞</span>
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs md:text-sm">Questions</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-5 lg:p-6 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 lg:w-7 lg:h-7 text-orange-600" />
              <span className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white truncate">
                {user.organization?.subscription_plan || 'Free'}
              </span>
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs md:text-sm">Plan</p>
          </div>
        </div>

        {/* Office Management Widget */}
        {user.organization && (
          <div className="mb-3 sm:mb-4 md:mb-6 lg:mb-8">
            <h2 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4 md:mb-6">
              Office Management
            </h2>
            <OfficeManagement userRole={user.role} />
          </div>
        )}

        {/* Communities Grid - Only show if user is admin or has assigned communities */}
        {(user.role === 'org_admin' || user.role === 'super_admin' || (user.assigned_communities && user.assigned_communities.length > 0)) && (
          <div className="mb-3 sm:mb-4 md:mb-6 lg:mb-8">
            <div className="flex items-center justify-between mb-3 sm:mb-4 md:mb-6">
              <h2 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white">
                Your Communities
              </h2>
              {user.role === 'community_lead' && (
                <span className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-full border border-indigo-300 dark:border-indigo-700">
                  🎖️ Community Lead
                </span>
              )}
            </div>
            
            {/* Filter communities: admins see all, regular users/leads see only assigned */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
                  {communities
                    .filter((community) => {
                      // Admins see all communities
                      if (user.role === 'org_admin' || user.role === 'super_admin') {
                        return true;
                      }
                      // Regular users and community leads see only assigned communities
                      return user.assigned_communities && user.assigned_communities.includes(community.id);
                    })
                    .map((community) => (
                    <a
                      key={community.id}
                      href={`/community/${community.id}`}
                      className="group bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-5 lg:p-6 shadow-md hover:shadow-xl transition-all duration-200 border-2 border-transparent hover:border-blue-500 hover:scale-[1.02]"
                    >
                      <div className="flex items-center justify-between mb-2 sm:mb-3 md:mb-4">
                        <div className={`${community.color} w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 lg:w-11 lg:h-11 rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-lg md:text-xl group-hover:scale-110 transition-transform duration-200`}>
                          {community.icon}
                        </div>
                        <span className="text-[10px] sm:text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400">
                          {community.agent}
                        </span>
                      </div>
                      <h3 className="text-xs sm:text-sm md:text-base font-bold text-gray-900 dark:text-white mb-1 sm:mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {community.name}
                      </h3>
                      <p className="text-[10px] sm:text-xs md:text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                        {community.description}
                      </p>
                    </a>
                  ))}
                </div>
          </div>
        )}

        {/* Recent Activity Placeholder */}
        <div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 lg:p-8 shadow-md">
          <h2 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
            Getting Started
          </h2>
          <div className="space-y-2 sm:space-y-3 md:space-y-4">
            <div className="flex items-start space-x-2 sm:space-x-3 md:space-x-4">
              <div className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                <span className="text-blue-600 dark:text-blue-400 font-bold text-[10px] sm:text-xs md:text-sm">1</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1 text-xs sm:text-sm md:text-base">
                  Choose a Community
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs md:text-sm">
                  Select a community that matches your role and interests
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-2 sm:space-x-3 md:space-x-4">
              <div className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 bg-purple-100 dark:bg-purple-900/20 rounded-full flex items-center justify-center">
                <span className="text-purple-600 dark:text-purple-400 font-bold text-[10px] sm:text-xs md:text-sm">2</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1 text-xs sm:text-sm md:text-base">
                  Start Chatting
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs md:text-sm">
                  Ask questions and get instant AI-powered assistance
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-2 sm:space-x-3 md:space-x-4">
              <div className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                <span className="text-green-600 dark:text-green-400 font-bold text-[10px] sm:text-xs md:text-sm">3</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1 text-xs sm:text-sm md:text-base">
                  Collaborate & Learn
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-[10px] sm:text-xs md:text-sm">
                  Learn from examples and improve your workflow
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
