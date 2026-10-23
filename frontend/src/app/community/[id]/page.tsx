'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import Header from '../../../components/Header'
import CommunityDashboard from '../../../components/CommunityDashboard'
import ProjectsPage from '../../../components/projects/ProjectsPage'
import ResizableChatPanel from '../../../components/ResizableChatPanel'
import { useChat } from '../../../contexts/ChatContext'

const communityData = {
  qa: {
    name: 'QA Engineers',
    icon: '🎯',
    agent: 'QualityGPT',
    color: 'bg-blue-500',
    capabilities: [
      { icon: '📝', title: 'Generate Tests', description: 'Create Playwright test code' },
      { icon: '🔍', title: 'Review Code', description: 'Analyze and improve tests' },
      { icon: '📚', title: 'Explain Concepts', description: 'Learn QA automation' },
      { icon: '🎯', title: 'Create Scenarios', description: 'Generate test scenarios' },
      { icon: '🐛', title: 'Debug Issues', description: 'Fix test failures' },
      { icon: '✅', title: 'Best Practices', description: 'Industry standards' }
    ],
    examples: [
      {
        category: '📝 Test Generation',
        queries: [
          'Generate a Playwright test for login functionality',
          'Create a test for e-commerce checkout flow',
          'Write tests for API endpoint validation',
          'Generate unit tests for user registration'
        ]
      },
      {
        category: '🔍 Code Review',
        queries: [
          'Review my Playwright test code for improvements',
          'Check my test structure for best practices',
          'Analyze test coverage and suggest improvements',
          'Optimize my test performance'
        ]
      },
      {
        category: '📚 Learning',
        queries: [
          'What is Page Object Model?',
          'Explain test automation pyramid',
          'How to implement data-driven testing?',
          'Best practices for test maintenance'
        ]
      },
      {
        category: '🐛 Debugging',
        queries: [
          'Why is my test failing intermittently?',
          'How to debug element not found errors?',
          'Fix timeout issues in my tests',
          'Resolve test environment setup problems'
        ]
      }
    ],
    placeholder: 'Ask me anything about QA automation...'
  },
  backend: {
    name: 'Backend Developers',
    icon: '🔧',
    agent: 'BackendGPT',
    color: 'bg-green-500',
    capabilities: [
      { icon: '🔧', title: 'API Design', description: 'RESTful and GraphQL APIs' },
      { icon: '🗄️', title: 'Database Design', description: 'Schema and optimization' },
      { icon: '🔒', title: 'Security', description: 'Authentication and authorization' },
      { icon: '⚡', title: 'Performance', description: 'Optimization and scaling' },
      { icon: '🐛', title: 'Debug Issues', description: 'Server-side troubleshooting' },
      { icon: '📊', title: 'Monitoring', description: 'Logging and metrics' }
    ],
    examples: [
      {
        category: '🔧 API Development',
        queries: [
          'Create a REST API for user management',
          'Design GraphQL schema for e-commerce',
          'Implement CRUD operations with Node.js',
          'Build microservices architecture'
        ]
      },
      {
        category: '🗄️ Database',
        queries: [
          'Design database schema for social media app',
          'Optimize slow PostgreSQL queries',
          'Implement database migrations',
          'Set up Redis caching strategy'
        ]
      },
      {
        category: '🔒 Security',
        queries: [
          'Implement JWT authentication',
          'Set up OAuth2 with Google',
          'Secure API endpoints with rate limiting',
          'Implement role-based access control'
        ]
      }
    ],
    placeholder: 'Ask me about backend development, APIs, databases...'
  },
  frontend: {
    name: 'Frontend Developers',
    icon: '🎨',
    agent: 'FrontendGPT',
    color: 'bg-purple-500',
    capabilities: [
      { icon: '⚛️', title: 'React/Vue/Angular', description: 'Modern frameworks' },
      { icon: '📱', title: 'Mobile Development', description: 'React Native, Flutter' },
      { icon: '🎨', title: 'UI Components', description: 'Reusable components' },
      { icon: '📐', title: 'Responsive Design', description: 'Mobile-first approach' },
      { icon: '⚡', title: 'Performance', description: 'Bundle optimization' },
      { icon: '🧪', title: 'Testing', description: 'Unit and integration tests' }
    ],
    examples: [
      {
        category: '⚛️ React Development',
        queries: [
          'Create a React component for user profile',
          'Implement state management with Redux',
          'Build a custom hook for API calls',
          'Set up React Router for navigation'
        ]
      },
      {
        category: '📱 Mobile Development',
        queries: [
          'Build a React Native navigation system',
          'Create responsive mobile layouts',
          'Implement native device features',
          'Optimize mobile app performance'
        ]
      },
      {
        category: '🎨 Styling & Design',
        queries: [
          'Create a responsive navbar with Tailwind',
          'Design a modern card component',
          'Implement dark mode toggle',
          'Build accessible form components'
        ]
      }
    ],
    placeholder: 'Ask me about frontend development, React, mobile apps...'
  },
  design: {
    name: 'UI/UX Designers',
    icon: '✨',
    agent: 'DesignGPT',
    color: 'bg-pink-500',
    capabilities: [
      { icon: '🎨', title: 'Design Systems', description: 'Consistent UI patterns' },
      { icon: '♿', title: 'Accessibility', description: 'WCAG compliance' },
      { icon: '🔄', title: 'User Flows', description: 'Journey mapping' },
      { icon: '🎭', title: 'Prototyping', description: 'Interactive mockups' },
      { icon: '📊', title: 'User Research', description: 'Data-driven design' },
      { icon: '🎯', title: 'Usability', description: 'User testing insights' }
    ],
    examples: [
      {
        category: '🎨 Design Systems',
        queries: [
          'Create a comprehensive button component library',
          'Design consistent color palette',
          'Build responsive grid system',
          'Establish typography scale'
        ]
      },
      {
        category: '♿ Accessibility',
        queries: [
          'Make my form components accessible',
          'Implement keyboard navigation',
          'Design for screen readers',
          'Ensure color contrast compliance'
        ]
      },
      {
        category: '🔄 User Experience',
        queries: [
          'Design effective onboarding flow',
          'Create user journey maps',
          'Optimize checkout process UX',
          'Design error handling patterns'
        ]
      }
    ],
    placeholder: 'Ask me about design systems, UX research, accessibility...'
  },
  product: {
    name: 'Product Managers',
    icon: '📊',
    agent: 'ProductGPT',
    color: 'bg-orange-500',
    capabilities: [
      { icon: '📋', title: 'Requirements', description: 'Feature specifications' },
      { icon: '📖', title: 'User Stories', description: 'Agile methodology' },
      { icon: '🗺️', title: 'Roadmaps', description: 'Strategic planning' },
      { icon: '📊', title: 'Analytics', description: 'Data-driven decisions' },
      { icon: '👥', title: 'Stakeholder Management', description: 'Communication' },
      { icon: '🎯', title: 'Market Research', description: 'Competitive analysis' }
    ],
    examples: [
      {
        category: '📋 Requirements',
        queries: [
          'Write detailed requirements for chat feature',
          'Create acceptance criteria for user login',
          'Define API specifications for mobile app',
          'Document integration requirements'
        ]
      },
      {
        category: '📖 User Stories',
        queries: [
          'Create user stories for e-commerce checkout',
          'Write epics for user management system',
          'Define story acceptance criteria',
          'Prioritize product backlog items'
        ]
      },
      {
        category: '🗺️ Strategy',
        queries: [
          'Plan Q1 product roadmap',
          'Define go-to-market strategy',
          'Create feature prioritization matrix',
          'Analyze competitor positioning'
        ]
      }
    ],
    placeholder: 'Ask me about product strategy, requirements, user stories...'
  },
  devops: {
    name: 'DevOps Engineers',
    icon: '🔐',
    agent: 'OpsGPT',
    color: 'bg-red-500',
    capabilities: [
      { icon: '🔄', title: 'CI/CD', description: 'Automated pipelines' },
      { icon: '☁️', title: 'Infrastructure', description: 'Cloud architecture' },
      { icon: '📊', title: 'Monitoring', description: 'System observability' },
      { icon: '🐳', title: 'Containerization', description: 'Docker and Kubernetes' },
      { icon: '🔒', title: 'Security', description: 'Infrastructure security' },
      { icon: '📈', title: 'Scaling', description: 'Performance optimization' }
    ],
    examples: [
      {
        category: '🔄 CI/CD',
        queries: [
          'Set up GitHub Actions pipeline for Node.js',
          'Create automated testing workflow',
          'Implement blue-green deployment',
          'Configure multi-environment deployments'
        ]
      },
      {
        category: '☁️ Infrastructure',
        queries: [
          'Deploy application to AWS with Terraform',
          'Set up Kubernetes cluster',
          'Configure load balancer and auto-scaling',
          'Implement disaster recovery strategy'
        ]
      },
      {
        category: '🐳 Containerization',
        queries: [
          'Containerize Node.js application with Docker',
          'Create Docker Compose for development',
          'Optimize Docker image size',
          'Set up Kubernetes deployment manifests'
        ]
      }
    ],
    placeholder: 'Ask me about CI/CD, infrastructure, monitoring, security...'
  },
  analyst: {
    name: 'Business System Analysts',
    icon: '�',
    agent: 'AnalystGPT',
    color: 'bg-indigo-500',
    capabilities: [
      { icon: '�', title: 'Requirements Analysis', description: 'Business requirements' },
      { icon: '�', title: 'Process Mapping', description: 'Workflow documentation' },
      { icon: '�', title: 'User Stories', description: 'Acceptance criteria' },
      { icon: '�', title: 'Process Optimization', description: 'Efficiency improvements' },
      { icon: '🔍', title: 'Gap Analysis', description: 'System evaluation' },
      { icon: '�', title: 'Business Cases', description: 'ROI analysis' }
    ],
    examples: [
      {
        category: '📚 Documentation',
        queries: [
          'Write comprehensive API documentation',
          'Create developer getting started guide',
          'Document software architecture',
          'Write troubleshooting guides'
        ]
      },
      {
        category: '🎓 Tutorials',
        queries: [
          'Create step-by-step React tutorial',
          'Write database setup guide',
          'Document deployment process',
          'Create video script for feature demo'
        ]
      },
      {
        category: '📝 Content Strategy',
        queries: [
          'Improve technical writing clarity',
          'Structure information architecture',
          'Create content style guide',
          'Plan documentation roadmap'
        ]
      }
    ],
    placeholder: 'Ask me about technical writing, documentation, tutorials...'
  }
}

export default function CommunityPage() {
  const params = useParams()
  const router = useRouter()
  const communityId = params.id as string
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [has2FA, setHas2FA] = useState<boolean | null>(null)
  const [user, setUser] = useState<any>(null)
  const [activeView, setActiveView] = useState<'dashboard' | 'projects'>('dashboard')
  const { isOpen: isChatOpen, openChat, closeChat, setActiveCommunityId } = useChat()
  
  const community = communityData[communityId as keyof typeof communityData]
  
  // Set active community for chat context
  useEffect(() => {
    console.log('Community page - communityId:', communityId);
    if (communityId) {
      console.log('Community page - calling setActiveCommunityId with:', communityId);
      setActiveCommunityId(communityId)
    }
  }, [communityId, setActiveCommunityId])

  // Close chat when leaving the community page
  useEffect(() => {
    return () => {
      closeChat()
    }
  }, [])
  
  useEffect(() => {
    // Check if user has access to this community and has 2FA enabled
    const userStr = localStorage.getItem('user');
    if (!userStr) {
      router.push('/login');
      return;
    }

    const checkAccess = async () => {
      try {
        const cachedUserData = JSON.parse(userStr);
        setUser(cachedUserData);
        
        // Fetch the latest user data from the backend to get current 2FA status
        const token = localStorage.getItem('token');
        if (token) {
          try {
            const response = await fetch('http://localhost:8002/api/auth/me', {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            if (response.ok) {
              const latestUserData = await response.json();
              setUser(latestUserData);
              
              // Check if user has 2FA enabled - if not, deny access
              const twoFAEnabled = latestUserData.two_fa_enabled || false;
              setHas2FA(twoFAEnabled);
              
              if (!twoFAEnabled) {
                setHasAccess(false);
                return;
              }
              
              // Super admins and org admins have access to all communities
              if (latestUserData.role === 'super_admin' || latestUserData.role === 'org_admin') {
                setHasAccess(true);
                return;
              }
              
              // Community leads have access to all communities
              if (latestUserData.role === 'community_lead') {
                setHasAccess(true);
                return;
              }
              
              // Regular users need to have the community assigned
              const assignedCommunities = latestUserData.assigned_communities || [];
              const hasAccessToCommunity = assignedCommunities.includes(communityId);
              setHasAccess(hasAccessToCommunity);
              return;
            }
          } catch (error) {
            // If fetch fails, fall back to cached data
            console.warn('Failed to fetch latest user data, using cached:', error);
          }
        }
        
        // Fallback to cached data if API call fails
        const twoFAEnabled = cachedUserData.two_fa_enabled || false;
        setHas2FA(twoFAEnabled);
        
        if (!twoFAEnabled) {
          setHasAccess(false);
          return;
        }
        
        if (cachedUserData.role === 'super_admin' || cachedUserData.role === 'org_admin') {
          setHasAccess(true);
          return;
        }
        
        if (cachedUserData.role === 'community_lead') {
          setHasAccess(true);
          return;
        }
        
        const assignedCommunities = cachedUserData.assigned_communities || [];
        const hasAccessToCommunity = assignedCommunities.includes(communityId);
        setHasAccess(hasAccessToCommunity);
        
      } catch (e) {
        router.push('/login');
      }
    };

    checkAccess();
  }, [communityId, router]);

  // Listen for request to open chat
  useEffect(() => {
    const handler = () => openChat(communityId);
    const chatWithQueryHandler = (e: any) => {
      if (e.detail?.query) {
        openChat(communityId);
      }
    };
    
    window.addEventListener('requestOpenChat', handler);
    window.addEventListener('openCommunityChatFromProject', handler);
    window.addEventListener('openCommunityChatWithQuery', chatWithQueryHandler);
    
    return () => {
      window.removeEventListener('requestOpenChat', handler);
      window.removeEventListener('openCommunityChatFromProject', handler);
      window.removeEventListener('openCommunityChatWithQuery', chatWithQueryHandler);
    };
  }, []);
  
  if (!community) {
    notFound()
  }

  // Show loading state while checking access
  if (hasAccess === null) {
    return (
      <div className="h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  // Show access denied message
  if (!hasAccess) {
    // Check if it's a 2FA issue
    const is2FAIssue = has2FA === false;
    
    return (
      <div className="h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4">
                <span className="text-3xl">{is2FAIssue ? '🔐' : '🔒'}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {is2FAIssue ? 'Two-Factor Authentication Required' : 'Access Denied'}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {is2FAIssue 
                  ? 'You must enable two-factor authentication to access community pages.'
                  : `You don't have access to the ${community?.name} community.`
                }
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
                {is2FAIssue
                  ? 'Go to Settings → Profile to enable 2FA using an authenticator app.'
                  : 'Please contact your organization administrator to request access to this community.'
                }
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Back to Dashboard
                </button>
                {is2FAIssue && (
                  <button
                    onClick={() => router.push('/settings')}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Go to Settings
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gray-900">
      {/* Sidebar Navigation */}
      <div className="w-64 bg-gray-900 text-white flex flex-col border-r border-gray-700 hidden lg:flex sticky top-0 h-screen">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-white mb-1">UnifiedWork</h1>
          <p className="text-sm text-gray-400">{community.name}</p>
        </div>

        <nav className="flex-1">
          <button
            onClick={() => setActiveView('dashboard')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeView === 'dashboard'
                ? 'bg-blue-600 border-r-3 border-white' 
                : 'hover:bg-gray-800'
            }`}
          >
            <span className="text-lg">📊</span>
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => setActiveView('projects')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeView === 'projects'
                ? 'bg-blue-600 border-r-3 border-white' 
                : 'hover:bg-gray-800'
            }`}
          >
            <span className="text-lg">📋</span>
            <span>Projects</span>
          </button>

          <div className="mt-8 px-6">
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full flex items-center gap-3 px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-800 rounded transition-colors"
            >
              <span className="text-lg">🏠</span>
              <span>All Communities</span>
            </button>
            <button
              onClick={() => {
                if (user?.role === 'super_admin' || user?.role === 'org_admin') {
                  window.open('/admin', '_blank');
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded transition-colors ${
                user?.role === 'super_admin' || user?.role === 'org_admin'
                  ? 'text-gray-300 hover:text-white hover:bg-gray-800'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
              disabled={user?.role !== 'super_admin' && user?.role !== 'org_admin'}
            >
              <span className="text-lg">⚙️</span>
              <span>Admin Panel</span>
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                router.push('/login');
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-800 rounded transition-colors"
            >
              <span className="text-lg">🚪</span>
              <span>Logout</span>
            </button>
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 sm:px-4 md:px-6 py-2 sm:py-3 sticky top-0 z-20">
          <div className="flex justify-between items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className={`w-8 sm:w-10 h-8 sm:h-10 rounded-full flex items-center justify-center text-lg sm:text-xl flex-shrink-0 ${community.color} text-white`}>
                {community.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-sm sm:text-base md:text-lg font-bold text-gray-900 dark:text-white truncate">
                  {community.name}
                </h1>
                <p className="text-[10px] sm:text-[11px] md:text-xs text-gray-600 dark:text-gray-400 truncate">
                  {activeView === 'projects' ? 'Projects' : 'Dashboard'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 md:gap-3 flex-wrap justify-end">
              {/* AI Assistant Button */}
              <button
                onClick={() => openChat(communityId)}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium"
                title="Open AI Assistant"
              >
                <span>💬</span>
                <span className="hidden sm:inline">AI</span>
              </button>
              <span className="hidden md:inline text-xs sm:text-sm text-gray-900 dark:text-white font-medium truncate max-w-[150px]">
                {user?.full_name || user?.username}
              </span>
              <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[8px] sm:text-[9px] md:text-[10px] font-medium whitespace-nowrap ${
                user?.role === 'super_admin' 
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                  : user?.role === 'org_admin'
                  ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                  : user?.role === 'community_lead'
                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
              }`}>
                {user?.role?.replace('_', ' ').toUpperCase() || 'USER'}
              </span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto relative">
          {/* Main Content Area */}
          <div className="h-full overflow-auto">
            {activeView === 'dashboard' && (
              <CommunityDashboard
                communityId={communityId}
                communityName={community.name}
                communityIcon={community.icon}
                communityColor={community.color}
                capabilities={community.capabilities}
              />
            )}
            {activeView === 'projects' && (
              <ProjectsPage
                communityId={communityId}
                communityName={community.name}
              />
            )}
          </div>
        </div>

        {/* Chat Overlay - Only visible when chat is open */}
        {isChatOpen && (
          <ResizableChatPanel 
            defaultWidth={600}
            minWidth={400}
            maxWidth={900}
          />
        )}

        {/* Floating Chat Button - Only visible when chat is closed */}
        {!isChatOpen && (
          <button
            onClick={() => {
              openChat(communityId);
            }}
            className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 z-40"
            title="Open AI Assistant"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
          </button>
        )}
      </div>
    </div>
  )
}
