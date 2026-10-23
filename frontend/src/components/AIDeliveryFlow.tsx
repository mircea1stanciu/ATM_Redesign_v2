'use client';

import { useState, useEffect } from 'react';

interface DeliveryFlowProps {
  communityId: string;
  communityName: string;
  communityColor: string;
}

interface DeliveryMetric {
  label: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
  icon: string;
}

interface AIInsight {
  type: 'success' | 'warning' | 'info' | 'error';
  title: string;
  message: string;
  action?: string;
  timestamp: string;
}

export default function AIDeliveryFlow({
  communityId,
  communityName,
  communityColor
}: DeliveryFlowProps) {
  const [activePhase, setActivePhase] = useState<string>('development');
  const [metrics, setMetrics] = useState<DeliveryMetric[]>([]);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Community-specific delivery phases
  const deliveryPhases = getCommunityPhases(communityId);

  useEffect(() => {
    loadMetrics();
    loadAIInsights();
  }, [communityId]);

  const loadMetrics = () => {
    const communityMetrics = getCommunityMetrics(communityId);
    setMetrics(communityMetrics);
  };

  const loadAIInsights = () => {
    const communityInsights = getCommunityInsights(communityId);
    setInsights(communityInsights);
  };

  const analyzeWithAI = async (phase: string) => {
    setIsAnalyzing(true);
    // Simulate AI analysis
    setTimeout(() => {
      const newInsight: AIInsight = {
        type: 'info',
        title: `AI Analysis: ${phase}`,
        message: `AI has analyzed your ${phase} phase and found opportunities for improvement.`,
        action: 'View Details',
        timestamp: new Date().toISOString()
      };
      setInsights([newInsight, ...insights]);
      setIsAnalyzing(false);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      {/* Delivery Flow Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              🚀 AI-Powered Delivery Flow
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Automated insights and optimizations for {communityName}
            </p>
          </div>
          <button
            onClick={() => analyzeWithAI(activePhase)}
            disabled={isAnalyzing}
            className={`px-4 py-2 ${communityColor} text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50`}
          >
            {isAnalyzing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Analyzing...
              </>
            ) : (
              <>
                <span>🤖</span>
                AI Analysis
              </>
            )}
          </button>
        </div>

        {/* Delivery Phases Timeline */}
        <div className="relative">
          <div className="flex justify-between items-center mb-8">
            {deliveryPhases.map((phase, index) => (
              <div
                key={phase.id}
                className="flex flex-col items-center flex-1 relative cursor-pointer"
                onClick={() => setActivePhase(phase.id)}
              >
                {/* Connector Line */}
                {index < deliveryPhases.length - 1 && (
                  <div className={`absolute top-6 left-1/2 w-full h-0.5 ${
                    phase.status === 'completed' ? communityColor : 'bg-gray-300 dark:bg-gray-600'
                  }`}></div>
                )}

                {/* Phase Icon */}
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-xl z-10 transition-all ${
                    activePhase === phase.id
                      ? `${communityColor} text-white shadow-lg scale-110`
                      : phase.status === 'completed'
                      ? `${communityColor} text-white`
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                  }`}
                >
                  {phase.icon}
                </div>

                {/* Phase Label */}
                <span className={`mt-2 text-xs font-medium text-center ${
                  activePhase === phase.id ? 'text-gray-900 dark:text-white' : 'text-gray-500'
                }`}>
                  {phase.label}
                </span>

                {/* AI Badge */}
                {phase.aiEnabled && (
                  <span className="mt-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 text-xs rounded-full">
                    AI ✨
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Active Phase Details */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
            Current Phase: {deliveryPhases.find(p => p.id === activePhase)?.label}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {deliveryPhases.find((p: any) => p.id === activePhase)?.description}
          </p>
          <div className="flex gap-2 flex-wrap">
            {deliveryPhases.find((p: any) => p.id === activePhase)?.actions.map((action: string, idx: number) => (
              <button
                key={idx}
                onClick={() => {
                  // Trigger AI Assistant with pre-filled query
                  const event = new CustomEvent('openCommunityChatWithQuery', {
                    detail: { query: action }
                  });
                  window.dispatchEvent(event);
                }}
                className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <div
            key={index}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{metric.icon}</span>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                metric.trend === 'up'
                  ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300'
                  : metric.trend === 'down'
                  ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}>
                {metric.change}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{metric.label}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{metric.value}</p>
          </div>
        ))}
      </div>

      {/* AI Insights Feed */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span>🤖</span>
          AI Insights & Recommendations
        </h3>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {insights.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-4xl mb-2">🎯</p>
              <p>No insights yet. Click "AI Analysis" to get started!</p>
            </div>
          ) : (
            insights.map((insight, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border-l-4 ${
                  insight.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-500'
                    : insight.type === 'warning'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
                    : insight.type === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-500'
                    : 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 dark:text-white mb-1">
                      {insight.title}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {insight.message}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(insight.timestamp).toLocaleString()}
                    </p>
                  </div>
                  {insight.action && (
                    <button className="ml-4 px-3 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                      {insight.action}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span>⚡</span>
          Quick AI Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {getQuickActions(communityId).map((action, index) => (
            <button
              key={index}
              onClick={() => {
                const event = new CustomEvent('openCommunityChatWithQuery', {
                  detail: { query: action.query }
                });
                window.dispatchEvent(event);
              }}
              className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              <span className="text-2xl">{action.icon}</span>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{action.title}</p>
                <p className="text-xs text-gray-500">{action.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper functions for community-specific data
function getCommunityPhases(communityId: string) {
  const phasesByCommunity: Record<string, any[]> = {
    qa: [
      {
        id: 'planning',
        label: 'Planning',
        icon: '📋',
        status: 'completed',
        aiEnabled: true,
        description: 'AI generates test scenarios and identifies test coverage gaps',
        actions: ['Generate test plan', 'Identify edge cases', 'Create test matrix']
      },
      {
        id: 'development',
        label: 'Test Dev',
        icon: '💻',
        status: 'active',
        aiEnabled: true,
        description: 'AI writes test code and suggests best practices',
        actions: ['Generate Playwright tests', 'Review test code', 'Optimize selectors']
      },
      {
        id: 'execution',
        label: 'Execution',
        icon: '▶️',
        status: 'pending',
        aiEnabled: true,
        description: 'AI monitors test execution and detects flaky tests',
        actions: ['Run test suite', 'Analyze failures', 'Debug flaky tests']
      },
      {
        id: 'reporting',
        label: 'Reporting',
        icon: '📊',
        status: 'pending',
        aiEnabled: true,
        description: 'AI generates insights from test results and trends',
        actions: ['Generate report', 'Analyze trends', 'Suggest improvements']
      },
      {
        id: 'monitoring',
        label: 'Monitor',
        icon: '👁️',
        status: 'pending',
        aiEnabled: true,
        description: 'AI continuously monitors test health and quality metrics',
        actions: ['View dashboards', 'Check alerts', 'Track metrics']
      }
    ],
    backend: [
      {
        id: 'design',
        label: 'API Design',
        icon: '🎨',
        status: 'completed',
        aiEnabled: true,
        description: 'AI helps design RESTful APIs and data schemas',
        actions: ['Design endpoints', 'Create schema', 'Review API design']
      },
      {
        id: 'development',
        label: 'Development',
        icon: '💻',
        status: 'active',
        aiEnabled: true,
        description: 'AI assists with code generation and optimization',
        actions: ['Generate CRUD operations', 'Optimize queries', 'Review code']
      },
      {
        id: 'testing',
        label: 'Testing',
        icon: '🧪',
        status: 'pending',
        aiEnabled: true,
        description: 'AI generates unit and integration tests',
        actions: ['Generate tests', 'Test API endpoints', 'Load testing']
      },
      {
        id: 'deployment',
        label: 'Deploy',
        icon: '🚀',
        status: 'pending',
        aiEnabled: true,
        description: 'AI monitors deployment health and predicts issues',
        actions: ['Deploy to staging', 'Run smoke tests', 'Deploy to production']
      },
      {
        id: 'monitoring',
        label: 'Monitor',
        icon: '📈',
        status: 'pending',
        aiEnabled: true,
        description: 'AI detects anomalies and performance issues',
        actions: ['View metrics', 'Check logs', 'Analyze performance']
      }
    ],
    frontend: [
      {
        id: 'design',
        label: 'Design',
        icon: '🎨',
        status: 'completed',
        aiEnabled: true,
        description: 'AI suggests component structure and design patterns',
        actions: ['Create components', 'Design layouts', 'Review UX']
      },
      {
        id: 'development',
        label: 'Development',
        icon: '💻',
        status: 'active',
        aiEnabled: true,
        description: 'AI assists with React/Next.js development',
        actions: ['Generate components', 'Optimize rendering', 'Add animations']
      },
      {
        id: 'testing',
        label: 'Testing',
        icon: '✅',
        status: 'pending',
        aiEnabled: true,
        description: 'AI generates component tests and checks accessibility',
        actions: ['Generate tests', 'Check accessibility', 'Visual regression']
      },
      {
        id: 'optimization',
        label: 'Optimize',
        icon: '⚡',
        status: 'pending',
        aiEnabled: true,
        description: 'AI optimizes bundle size and performance',
        actions: ['Analyze bundle', 'Optimize images', 'Improve performance']
      },
      {
        id: 'deployment',
        label: 'Deploy',
        icon: '🚀',
        status: 'pending',
        aiEnabled: true,
        description: 'AI monitors build and deployment process',
        actions: ['Build production', 'Deploy to Vercel', 'Verify deployment']
      }
    ],
    design: [
      {
        id: 'research',
        label: 'Research',
        icon: '🔍',
        status: 'completed',
        aiEnabled: true,
        description: 'AI analyzes user behavior and design trends',
        actions: ['Analyze users', 'Research competitors', 'Find trends']
      },
      {
        id: 'ideation',
        label: 'Ideation',
        icon: '💡',
        status: 'active',
        aiEnabled: true,
        description: 'AI generates design concepts and variations',
        actions: ['Generate concepts', 'Create wireframes', 'Design mockups']
      },
      {
        id: 'prototype',
        label: 'Prototype',
        icon: '🎨',
        status: 'pending',
        aiEnabled: true,
        description: 'AI creates interactive prototypes',
        actions: ['Build prototype', 'Add interactions', 'User testing']
      },
      {
        id: 'feedback',
        label: 'Feedback',
        icon: '💬',
        status: 'pending',
        aiEnabled: true,
        description: 'AI analyzes user feedback and sentiment',
        actions: ['Collect feedback', 'Analyze results', 'Iterate design']
      },
      {
        id: 'handoff',
        label: 'Handoff',
        icon: '🤝',
        status: 'pending',
        aiEnabled: true,
        description: 'AI generates design specifications and code',
        actions: ['Create specs', 'Export assets', 'Generate code']
      }
    ],
    product: [
      {
        id: 'discovery',
        label: 'Discovery',
        icon: '🔍',
        status: 'completed',
        aiEnabled: true,
        description: 'AI identifies market opportunities and user needs',
        actions: ['Analyze market', 'User research', 'Competitive analysis']
      },
      {
        id: 'planning',
        label: 'Planning',
        icon: '📋',
        status: 'active',
        aiEnabled: true,
        description: 'AI prioritizes features and creates roadmaps',
        actions: ['Prioritize backlog', 'Create roadmap', 'Define metrics']
      },
      {
        id: 'development',
        label: 'Development',
        icon: '🛠️',
        status: 'pending',
        aiEnabled: true,
        description: 'AI tracks progress and predicts delivery dates',
        actions: ['Track sprints', 'Monitor velocity', 'Manage risks']
      },
      {
        id: 'launch',
        label: 'Launch',
        icon: '🚀',
        status: 'pending',
        aiEnabled: true,
        description: 'AI optimizes launch strategy and timing',
        actions: ['Plan launch', 'Marketing strategy', 'Release notes']
      },
      {
        id: 'analytics',
        label: 'Analytics',
        icon: '📊',
        status: 'pending',
        aiEnabled: true,
        description: 'AI analyzes usage data and suggests improvements',
        actions: ['View metrics', 'Analyze trends', 'User insights']
      }
    ],
    devops: [
      {
        id: 'infrastructure',
        label: 'Infrastructure',
        icon: '🏗️',
        status: 'completed',
        aiEnabled: true,
        description: 'AI optimizes infrastructure and suggests improvements',
        actions: ['Design architecture', 'Setup CI/CD', 'Configure monitoring']
      },
      {
        id: 'deployment',
        label: 'Deployment',
        icon: '🚀',
        status: 'active',
        aiEnabled: true,
        description: 'AI automates and monitors deployments',
        actions: ['Deploy services', 'Rollback strategy', 'Canary release']
      },
      {
        id: 'monitoring',
        label: 'Monitoring',
        icon: '👁️',
        status: 'pending',
        aiEnabled: true,
        description: 'AI detects anomalies and predicts failures',
        actions: ['Setup alerts', 'View dashboards', 'Analyze logs']
      },
      {
        id: 'optimization',
        label: 'Optimize',
        icon: '⚡',
        status: 'pending',
        aiEnabled: true,
        description: 'AI identifies cost savings and performance gains',
        actions: ['Optimize costs', 'Improve performance', 'Scale resources']
      },
      {
        id: 'security',
        label: 'Security',
        icon: '🔒',
        status: 'pending',
        aiEnabled: true,
        description: 'AI scans for vulnerabilities and compliance issues',
        actions: ['Security scan', 'Compliance check', 'Update policies']
      }
    ],
    business: [
      {
        id: 'requirements',
        label: 'Requirements',
        icon: '📝',
        status: 'completed',
        aiEnabled: true,
        description: 'AI helps gather and document requirements',
        actions: ['Document requirements', 'Create user stories', 'Define acceptance criteria']
      },
      {
        id: 'analysis',
        label: 'Analysis',
        icon: '📊',
        status: 'active',
        aiEnabled: true,
        description: 'AI analyzes data and identifies patterns',
        actions: ['Analyze data', 'Create reports', 'Identify trends']
      },
      {
        id: 'modeling',
        label: 'Modeling',
        icon: '🎯',
        status: 'pending',
        aiEnabled: true,
        description: 'AI creates process models and diagrams',
        actions: ['Create diagrams', 'Model processes', 'Document flows']
      },
      {
        id: 'validation',
        label: 'Validation',
        icon: '✅',
        status: 'pending',
        aiEnabled: true,
        description: 'AI validates requirements against business goals',
        actions: ['Validate requirements', 'Test scenarios', 'User acceptance']
      },
      {
        id: 'optimization',
        label: 'Optimize',
        icon: '⚡',
        status: 'pending',
        aiEnabled: true,
        description: 'AI suggests process improvements',
        actions: ['Optimize processes', 'Reduce costs', 'Improve efficiency']
      }
    ]
  };

  return phasesByCommunity[communityId] || phasesByCommunity.qa;
}

function getCommunityMetrics(communityId: string): DeliveryMetric[] {
  const metricsByCommunity: Record<string, DeliveryMetric[]> = {
    qa: [
      { label: 'Test Coverage', value: '87%', change: '+5%', trend: 'up', icon: '📊' },
      { label: 'Pass Rate', value: '94%', change: '+2%', trend: 'up', icon: '✅' },
      { label: 'Avg Test Time', value: '3.2s', change: '-0.8s', trend: 'up', icon: '⚡' },
      { label: 'Flaky Tests', value: '3', change: '-2', trend: 'up', icon: '🎯' }
    ],
    backend: [
      { label: 'API Response', value: '120ms', change: '-30ms', trend: 'up', icon: '⚡' },
      { label: 'Error Rate', value: '0.2%', change: '-0.1%', trend: 'up', icon: '🐛' },
      { label: 'DB Queries', value: '45ms', change: '-10ms', trend: 'up', icon: '🗄️' },
      { label: 'Uptime', value: '99.9%', change: '+0.1%', trend: 'up', icon: '✅' }
    ],
    frontend: [
      { label: 'Page Load', value: '1.2s', change: '-0.3s', trend: 'up', icon: '⚡' },
      { label: 'Bundle Size', value: '180KB', change: '-20KB', trend: 'up', icon: '📦' },
      { label: 'Lighthouse', value: '95', change: '+5', trend: 'up', icon: '💯' },
      { label: 'Accessibility', value: '98%', change: '+3%', trend: 'up', icon: '♿' }
    ],
    design: [
      { label: 'User Satisfaction', value: '4.8/5', change: '+0.2', trend: 'up', icon: '⭐' },
      { label: 'Conversion Rate', value: '3.2%', change: '+0.5%', trend: 'up', icon: '📈' },
      { label: 'Design Iterations', value: '3.5', change: '-1', trend: 'up', icon: '🔄' },
      { label: 'Time to Market', value: '14d', change: '-3d', trend: 'up', icon: '⏱️' }
    ],
    product: [
      { label: 'Active Users', value: '12.5K', change: '+2.1K', trend: 'up', icon: '👥' },
      { label: 'Feature Adoption', value: '68%', change: '+12%', trend: 'up', icon: '🎯' },
      { label: 'Sprint Velocity', value: '42', change: '+5', trend: 'up', icon: '⚡' },
      { label: 'Customer NPS', value: '72', change: '+8', trend: 'up', icon: '💯' }
    ],
    devops: [
      { label: 'Deploy Frequency', value: '8/day', change: '+3', trend: 'up', icon: '🚀' },
      { label: 'Lead Time', value: '2.5h', change: '-1h', trend: 'up', icon: '⏱️' },
      { label: 'MTTR', value: '12min', change: '-8min', trend: 'up', icon: '🔧' },
      { label: 'Change Failure', value: '2%', change: '-1%', trend: 'up', icon: '✅' }
    ],
    business: [
      { label: 'Requirements', value: '24', change: '+6', trend: 'up', icon: '📝' },
      { label: 'Completed', value: '18', change: '+4', trend: 'up', icon: '✅' },
      { label: 'Cycle Time', value: '5.2d', change: '-1.5d', trend: 'up', icon: '⏱️' },
      { label: 'Stakeholder Sat.', value: '4.6/5', change: '+0.3', trend: 'up', icon: '⭐' }
    ]
  };

  return metricsByCommunity[communityId] || metricsByCommunity.qa;
}

function getCommunityInsights(communityId: string): AIInsight[] {
  const insightsByCommunity: Record<string, AIInsight[]> = {
    qa: [
      {
        type: 'success',
        title: 'Test Coverage Improved',
        message: 'Your test coverage increased by 5% this week. Great job on adding tests for the new authentication flow!',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      },
      {
        type: 'warning',
        title: 'Flaky Test Detected',
        message: 'Test "user-login-flow.spec.ts" is failing intermittently. AI suggests adding explicit waits for API calls.',
        action: 'Fix Now',
        timestamp: new Date(Date.now() - 7200000).toISOString()
      },
      {
        type: 'info',
        title: 'Optimization Opportunity',
        message: 'AI detected that 3 tests can be parallelized to reduce execution time by 40%.',
        action: 'View Details',
        timestamp: new Date(Date.now() - 10800000).toISOString()
      }
    ],
    backend: [
      {
        type: 'success',
        title: 'API Performance Improved',
        message: 'Your database query optimization reduced average response time by 30ms. Excellent work!',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      },
      {
        type: 'warning',
        title: 'High Memory Usage Detected',
        message: 'The /api/users endpoint is using 85% more memory than expected. AI suggests implementing pagination.',
        action: 'Optimize',
        timestamp: new Date(Date.now() - 7200000).toISOString()
      }
    ],
    frontend: [
      {
        type: 'success',
        title: 'Bundle Size Reduced',
        message: 'Successfully removed unused dependencies, reducing bundle size by 20KB. Load time improved!',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      },
      {
        type: 'info',
        title: 'Lighthouse Score Update',
        message: 'Your Lighthouse score improved to 95. AI suggests lazy-loading images for further improvement.',
        action: 'View Tips',
        timestamp: new Date(Date.now() - 7200000).toISOString()
      }
    ],
    design: [
      {
        type: 'success',
        title: 'User Satisfaction Up',
        message: 'User satisfaction score increased by 0.2 points after the new onboarding flow. Great UX improvement!',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      },
      {
        type: 'info',
        title: 'A/B Test Results',
        message: 'Design variant B has 15% higher conversion rate. AI recommends making it the default.',
        action: 'Review Data',
        timestamp: new Date(Date.now() - 7200000).toISOString()
      }
    ],
    product: [
      {
        type: 'success',
        title: 'Feature Adoption Growing',
        message: 'New feature adoption rate is 68%, exceeding the 50% target. Users love it!',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      },
      {
        type: 'warning',
        title: 'Sprint at Risk',
        message: 'Current sprint velocity is below target. AI suggests moving 2 low-priority items to next sprint.',
        action: 'Adjust Sprint',
        timestamp: new Date(Date.now() - 7200000).toISOString()
      }
    ],
    devops: [
      {
        type: 'success',
        title: 'Deployment Frequency Up',
        message: 'You deployed 8 times today, a new record! CI/CD optimizations are paying off.',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      },
      {
        type: 'warning',
        title: 'Resource Usage Spike',
        message: 'Production CPU usage spiked to 85% during peak hours. AI recommends enabling auto-scaling.',
        action: 'Configure Scaling',
        timestamp: new Date(Date.now() - 7200000).toISOString()
      }
    ],
    business: [
      {
        type: 'success',
        title: 'Requirements Clarity Improved',
        message: 'AI analysis shows 90% of requirements are now well-defined with clear acceptance criteria.',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      },
      {
        type: 'info',
        title: 'Process Optimization',
        message: 'AI identified that approval workflow can be streamlined to save 2 days per requirement.',
        action: 'Review Suggestion',
        timestamp: new Date(Date.now() - 7200000).toISOString()
      }
    ]
  };

  return insightsByCommunity[communityId] || insightsByCommunity.qa;
}

function getQuickActions(communityId: string) {
  const actionsByCommunity: Record<string, any[]> = {
    qa: [
      {
        icon: '🤖',
        title: 'Generate Test Plan',
        description: 'AI creates comprehensive test plan',
        query: 'Generate a test plan for the new user authentication feature'
      },
      {
        icon: '🔍',
        title: 'Review My Tests',
        description: 'AI reviews and suggests improvements',
        query: 'Review my Playwright tests and suggest improvements'
      },
      {
        icon: '🐛',
        title: 'Debug Flaky Test',
        description: 'AI helps fix intermittent failures',
        query: 'Help me debug this flaky test that fails intermittently'
      },
      {
        icon: '📊',
        title: 'Analyze Coverage',
        description: 'AI identifies coverage gaps',
        query: 'Analyze my test coverage and suggest areas to test'
      }
    ],
    backend: [
      {
        icon: '🔧',
        title: 'Design API',
        description: 'AI helps design RESTful endpoints',
        query: 'Design a REST API for user management with CRUD operations'
      },
      {
        icon: '⚡',
        title: 'Optimize Query',
        description: 'AI optimizes database queries',
        query: 'Optimize this slow database query'
      },
      {
        icon: '🔒',
        title: 'Security Review',
        description: 'AI checks for vulnerabilities',
        query: 'Review my API for security vulnerabilities'
      },
      {
        icon: '📊',
        title: 'Performance Analysis',
        description: 'AI analyzes performance metrics',
        query: 'Analyze my API performance and suggest optimizations'
      }
    ],
    frontend: [
      {
        icon: '🎨',
        title: 'Generate Component',
        description: 'AI creates React components',
        query: 'Generate a reusable modal component with React and TypeScript'
      },
      {
        icon: '⚡',
        title: 'Optimize Performance',
        description: 'AI improves page speed',
        query: 'How can I optimize the performance of this component?'
      },
      {
        icon: '♿',
        title: 'Accessibility Check',
        description: 'AI ensures WCAG compliance',
        query: 'Check my component for accessibility issues'
      },
      {
        icon: '📦',
        title: 'Reduce Bundle',
        description: 'AI minimizes bundle size',
        query: 'Help me reduce my JavaScript bundle size'
      }
    ],
    design: [
      {
        icon: '💡',
        title: 'Generate Concepts',
        description: 'AI creates design variations',
        query: 'Generate 3 design concepts for a modern dashboard'
      },
      {
        icon: '🎯',
        title: 'Analyze UX',
        description: 'AI evaluates user experience',
        query: 'Analyze the UX of this user flow and suggest improvements'
      },
      {
        icon: '🎨',
        title: 'Color Palette',
        description: 'AI suggests color schemes',
        query: 'Suggest an accessible color palette for a financial app'
      },
      {
        icon: '📱',
        title: 'Responsive Design',
        description: 'AI optimizes for all devices',
        query: 'Help me make this design responsive for mobile'
      }
    ],
    product: [
      {
        icon: '🎯',
        title: 'Prioritize Backlog',
        description: 'AI ranks features by impact',
        query: 'Help me prioritize my product backlog using RICE framework'
      },
      {
        icon: '📊',
        title: 'Analyze Metrics',
        description: 'AI interprets usage data',
        query: 'Analyze these user metrics and provide insights'
      },
      {
        icon: '🚀',
        title: 'Launch Strategy',
        description: 'AI plans product launch',
        query: 'Create a go-to-market strategy for our new feature'
      },
      {
        icon: '💡',
        title: 'Feature Ideas',
        description: 'AI suggests new features',
        query: 'Suggest innovative features based on user feedback'
      }
    ],
    devops: [
      {
        icon: '🏗️',
        title: 'Design Architecture',
        description: 'AI suggests infrastructure',
        query: 'Design a scalable cloud architecture for my application'
      },
      {
        icon: '🚀',
        title: 'Setup CI/CD',
        description: 'AI creates pipeline config',
        query: 'Create a CI/CD pipeline with GitHub Actions'
      },
      {
        icon: '📈',
        title: 'Cost Optimization',
        description: 'AI finds savings',
        query: 'Analyze my cloud costs and suggest optimizations'
      },
      {
        icon: '🔒',
        title: 'Security Scan',
        description: 'AI checks for vulnerabilities',
        query: 'Scan my infrastructure for security vulnerabilities'
      }
    ],
    business: [
      {
        icon: '📝',
        title: 'Document Requirements',
        description: 'AI creates user stories',
        query: 'Help me document requirements for a new feature'
      },
      {
        icon: '📊',
        title: 'Create Report',
        description: 'AI generates insights',
        query: 'Create a business analysis report from this data'
      },
      {
        icon: '🎯',
        title: 'Process Diagram',
        description: 'AI visualizes workflows',
        query: 'Create a process flow diagram for order fulfillment'
      },
      {
        icon: '💡',
        title: 'Optimize Process',
        description: 'AI improves efficiency',
        query: 'Analyze this business process and suggest improvements'
      }
    ]
  };

  return actionsByCommunity[communityId] || actionsByCommunity.qa;
}
