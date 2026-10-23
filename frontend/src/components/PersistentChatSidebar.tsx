'use client';

import { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { useChat } from '../contexts/ChatContext';
import MessengerView from './MessengerView';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp?: string;
}

interface Capability {
  icon: string;
  title: string;
  description: string;
}

interface ExampleCategory {
  category: string;
  queries: string[];
}

// Community data - should match the main community data
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
          'Write tests for API endpoint validation'
        ]
      }
    ]
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
    examples: []
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
    examples: []
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
    examples: []
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
    examples: []
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
    examples: []
  },
  analyst: {
    name: 'Business System Analysts',
    icon: '📈',
    agent: 'AnalystGPT',
    color: 'bg-indigo-500',
    capabilities: [
      { icon: '📊', title: 'Data Analysis', description: 'Analyze and interpret complex data' },
      { icon: '📈', title: 'Visualization', description: 'Create compelling data visualizations' },
      { icon: '🔍', title: 'SQL Queries', description: 'Write efficient database queries' },
      { icon: '📋', title: 'Requirements', description: 'Gather and analyze requirements' },
      { icon: '📏', title: 'KPIs', description: 'Define and track key metrics' },
      { icon: '🔧', title: 'Process Improvement', description: 'Optimize business processes' }
    ],
    examples: []
  }
};

export default function PersistentChatSidebar() {
  const { isOpen, closeChat, activeCommunityId, setActiveCommunityId, activeTab, setActiveTab } = useChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // Emit collapse state changes
  useEffect(() => {
    const event = new CustomEvent('chatCollapseChanged', {
      detail: { isCollapsed }
    });
    window.dispatchEvent(event);
  }, [isCollapsed]);
  const [isClient, setIsClient] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Get community data based on active community
  const community = activeCommunityId ? communityData[activeCommunityId as keyof typeof communityData] : null;

  // Show chat if it's open and either messenger tab or AI tab
  const shouldShowChat = isOpen;



  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
  }, [messages]);

  // Clear messages when switching communities
  useEffect(() => {
    setMessages([]);
  }, [activeCommunityId]);

  // Listen for community changes from page navigation
  useEffect(() => {
    const handleCommunityChange = (e: CustomEvent) => {
      if (e.detail?.communityId) {
        setActiveCommunityId(e.detail.communityId);
      }
    };

    window.addEventListener('communityChanged' as any, handleCommunityChange);
    return () => window.removeEventListener('communityChanged' as any, handleCommunityChange);
  }, [setActiveCommunityId]);

  const formatMessage = (content: string) => {
    const html = marked(content, {
      breaks: true,
      gfm: true,
    });
    return { __html: html };
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || !activeCommunityId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue.trim(),
      sender: 'user',
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const { default: apiClient } = await import('../services/api');
      const response = await apiClient.sendMessage(activeCommunityId, userMessage.content);

      if (response.data) {
        const agentMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: response.data.response,
          sender: 'agent',
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, agentMessage]);
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `❌ Error: ${error.response?.data?.detail || error.message || 'Failed to send message'}`,
        sender: 'agent',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const autoResizeTextarea = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const clearConversation = () => {
    setMessages([]);
  };

  // Don't render on server side to prevent hydration errors
  if (!isClient) {
    return null;
  }

  // Don't render if chat is closed or conditions not met
  if (!shouldShowChat) {
    return null;
  }

  return (
    <>
      {/* Backdrop Blur */}
      <div 
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity duration-300"
        onClick={closeChat}
      />

      {/* Chat Overlay */}
      <div className={`fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-xl shadow-2xl z-50 transition-all duration-300 ${
        isCollapsed ? 'w-16 h-16' : 'w-[900px] h-[800px]'
      }`}>
        
        {/* Collapsed State */}
        {isCollapsed && (
          <div className="h-full flex flex-col items-center py-4">
            <button
              onClick={() => setIsCollapsed(false)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors mb-2"
              title="Expand chat"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.003 9.003 0 01-8.716-6.747M3 12c0-4.418 4.03-8 9-8a8.997 8.997 0 018.716 6.747M21 12H3" />
              </svg>
            </button>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-blue-500 text-white mb-2">
              {activeTab === 'ai' ? (community?.icon || '🤖') : '💬'}
            </div>
            <button
              onClick={closeChat}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
              title="Close chat"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Expanded State */}
        {!isCollapsed && (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              {/* Tab Navigation */}
              <div className="flex items-center justify-between p-4 pb-2">
                <div className="flex space-x-1">
                  <button
                    onClick={() => setActiveTab('ai')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'ai'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    🤖 AI Assistant
                  </button>
                  <button
                    onClick={() => setActiveTab('messenger')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'messenger'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    💬 Messenger
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsCollapsed(true)}
                    className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Minimize chat"
                  >
                    <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </button>
                  <button
                    onClick={closeChat}
                    className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Close chat"
                  >
                    <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* AI Assistant Header (when AI tab is active) */}
              {activeTab === 'ai' && community && (
                <div className="flex items-center gap-3 px-4 pb-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${community.color} text-white`}>
                    {community.icon}
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-white text-sm">
                      {community.agent}
                    </h2>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {community.name}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900">
              {activeTab === 'messenger' ? (
                <MessengerView />
              ) : activeTab === 'ai' && community ? (
                <>
                  {/* Quick Actions */}
                  <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => setShowExamples(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors text-xs font-medium"
                    >
                      <span>💡</span>
                      <span>Examples</span>
                    </button>
                    <button
                      onClick={clearConversation}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-medium"
                    >
                      <span>🗑️</span>
                      <span>Clear</span>
                    </button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
                    {messages.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center px-4">
                          <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-3xl ${community.color} text-white`}>
                            {community.icon}
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                            How can I help?
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            Ask me anything about {community.name.toLowerCase()}
                          </p>
                          <button
                            onClick={() => setShowExamples(true)}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            View example questions →
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {messages.map((message) => (
                          <div
                            key={message.id}
                            className={`flex gap-2 ${
                              message.sender === 'user' ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            {message.sender === 'agent' && (
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${community.color} text-white flex-shrink-0 mt-1`}>
                                {community.icon}
                              </div>
                            )}

                            <div
                              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                                message.sender === 'user'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                              }`}
                            >
                              <div
                                className={`prose prose-sm max-w-none ${
                                  message.sender === 'user'
                                    ? 'prose-invert'
                                    : 'dark:prose-invert'
                                }`}
                                dangerouslySetInnerHTML={formatMessage(message.content)}
                              />
                              {message.timestamp && (
                                <div className={`text-xs mt-1 ${
                                  message.sender === 'user' ? 'opacity-70' : 'opacity-50'
                                }`}>
                                  {formatTimestamp(message.timestamp)}
                                </div>
                              )}
                            </div>

                            {message.sender === 'user' && (
                              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 mt-1">
                                👤
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Loading Indicator */}
                    {isLoading && (
                      <div className="flex items-start gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${community.color} text-white`}>
                          {community.icon}
                        </div>
                        <div className="bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex space-x-1">
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                            </div>
                            <span className="text-xs text-gray-600 dark:text-gray-400">Thinking...</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input Area */}
                  <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                    <form onSubmit={handleSubmit}>
                      <div className="flex gap-2">
                        <textarea
                          ref={textareaRef}
                          value={inputValue}
                          onChange={autoResizeTextarea}
                          onKeyDown={handleKeyDown}
                          placeholder="Ask me anything..."
                          className="flex-1 resize-none border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm min-h-[40px] max-h-[120px]"
                          rows={1}
                        />
                        <button
                          type="submit"
                          disabled={!inputValue.trim() || isLoading}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm flex items-center gap-1"
                        >
                          <span>↑</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center px-4">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">🤖</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Select a Community
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Choose a community to start chatting with an AI assistant
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Examples Modal */}
      {showExamples && community && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">💡 Example Queries</h2>
              <button
                onClick={() => setShowExamples(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-6">
              {community.examples.length > 0 ? (
                community.examples.map((category, index) => (
                  <div key={index}>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-3">
                      {category.category}
                    </h3>
                    <div className="space-y-2">
                      {category.queries.map((query: string, queryIndex: number) => (
                        <button
                          key={queryIndex}
                          onClick={() => {
                            setInputValue(query);
                            setShowExamples(false);
                            textareaRef.current?.focus();
                          }}
                          className="block w-full text-left p-3 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg text-sm transition-colors"
                        >
                          {query}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                  <p>No examples available for this community yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
