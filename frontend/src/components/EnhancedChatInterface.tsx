'use client';

import { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

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

interface EnhancedChatInterfaceProps {
  communityId: string;
  communityName: string;
  communityIcon: string;
  communityColor: string;
  capabilities: Capability[];
  examples?: ExampleCategory[];
}

export default function EnhancedChatInterface({ 
  communityId, 
  communityName, 
  communityIcon,
  communityColor,
  capabilities,
  examples = []
}: EnhancedChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [theme, setTheme] = useState('light');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Apply syntax highlighting to new messages
    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
  }, [messages]);

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue.trim(),
      sender: 'user',
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setConversationStarted(true);

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      // Import API client dynamically to avoid SSR issues
      const { default: apiClient } = await import('../services/api');
      
      const response = await apiClient.sendMessage(communityId, userMessage.content);
      
      if (response.data) {
        const agentMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: response.data.response,
          sender: 'agent',
          timestamp: response.data.timestamp || new Date().toISOString()
        };
        setMessages(prev => [...prev, agentMessage]);
      } else {
        throw new Error(response.error || 'Failed to get response');
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `❌ Error: ${error instanceof Error ? error.message : 'Something went wrong'}. Please try again.`,
        sender: 'agent',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const clearConversation = async () => {
    if (!confirm('Are you sure you want to clear the conversation?')) {
      return;
    }

    try {
      // Clear messages locally
      setMessages([]);
      setConversationStarted(false);
      
      // Optionally call API to clear server-side session
      // const { default: apiClient } = await import('../services/api');
      // await apiClient.clearSession(communityId);
    } catch (error) {
      console.error('Error clearing conversation:', error);
    }
  };

  const formatMessage = (content: string) => {
    const html = marked.parse(content);
    return { __html: html };
  };

  const autoResizeTextarea = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    setInputValue(textarea.value);
  };

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  return (
    <div className="flex flex-1 h-full bg-gray-50 dark:bg-gray-900">
      {/* Sidebar with Capabilities */}
      <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        {/* Sidebar Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <span className="text-2xl">{communityIcon}</span>
              {communityName}
            </h3>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title="Toggle theme"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            🎯 What I Can Do
          </h4>
        </div>

        {/* Capabilities List */}
        <div className="flex-1 p-6 overflow-y-auto">
          <ul className="space-y-4 mb-6">
            {capabilities.map((capability, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="text-xl mt-1">{capability.icon}</span>
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white text-sm">
                    {capability.title}
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {capability.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {/* Action Buttons */}
          <div className="space-y-3">
            <button
              onClick={() => setShowExamples(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors text-sm font-medium"
            >
              💡 Examples
            </button>
            <button
              onClick={clearConversation}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
            >
              🗑️ Clear Chat
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto">
          {/* Welcome Message */}
          {!conversationStarted && (
            <div className="p-8">
              <div className="max-w-4xl mx-auto text-center">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                    👋 Welcome to {communityName}!
                  </h2>
                  <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
                    I'm here to help you with all your {communityName.toLowerCase()} needs. Ask me anything about:
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto mb-8">
                  {capabilities.slice(0, 4).map((capability, index) => (
                    <div key={index} className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-2xl">{capability.icon}</span>
                        <strong className="text-gray-900 dark:text-white font-medium">
                          {capability.title}
                        </strong>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 text-left">
                        "{capability.description}"
                      </p>
                    </div>
                  ))}
                </div>
                
                <p className="text-gray-500 dark:text-gray-400">
                  Type a message below to get started! 🚀
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          {conversationStarted && (
            <div className="p-6">
              <div className="max-w-4xl mx-auto space-y-6">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-4 ${
                      message.sender === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {message.sender === 'agent' && (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${communityColor} text-white flex-shrink-0`}>
                        {communityIcon}
                      </div>
                    )}
                    
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                        message.sender === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700'
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
                        <div className="text-xs opacity-70 mt-2">
                          {formatTimestamp(message.timestamp)}
                        </div>
                      )}
                    </div>

                    {message.sender === 'user' && (
                      <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white text-lg flex-shrink-0">
                        👤
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="px-6 pb-6">
              <div className="max-w-4xl mx-auto flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${communityColor} text-white`}>
                  {communityIcon}
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Agent is thinking...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
            <div className="flex gap-4">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={autoResizeTextarea}
                onKeyDown={handleKeyDown}
                placeholder={`Ask me anything about ${communityName.toLowerCase()}...`}
                className="flex-1 resize-none border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none min-h-[50px] max-h-[200px]"
                rows={1}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                <span>Send</span>
                <span className="text-xs opacity-75">⏎</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Examples Modal */}
      {showExamples && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full m-4 max-h-[80vh] overflow-y-auto">
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
              {examples.length > 0 ? (
                examples.map((category, index) => (
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
    </div>
  );
}
