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

interface SideChatPanelProps {
  communityId: string;
  communityName: string;
  communityIcon: string;
  communityColor: string;
  capabilities: Capability[];
  examples?: ExampleCategory[];
  isOpen: boolean;
  onClose: () => void;
}

export default function SideChatPanel({
  communityId,
  communityName,
  communityIcon,
  communityColor,
  capabilities,
  examples = [],
  isOpen,
  onClose
}: SideChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Listen for custom events to open chat with pre-filled query
  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.query) {
        setInputValue(e.detail.query);
        if (!isOpen) {
          // Trigger parent to open panel
          const openEvent = new CustomEvent('requestOpenChat');
          window.dispatchEvent(openEvent);
        }
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    };
    
    const deliveryFlowHandler = (e: any) => {
      if (e.detail?.query) {
        setInputValue(e.detail.query);
        // Auto-focus the input
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    };
    
    window.addEventListener('openChatWithQuery', handler);
    window.addEventListener('openCommunityChatWithQuery', deliveryFlowHandler);
    return () => {
      window.removeEventListener('openChatWithQuery', handler);
      window.removeEventListener('openCommunityChatWithQuery', deliveryFlowHandler);
    };
  }, [isOpen]);

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

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const { default: apiClient } = await import('../services/api');
      const response = await apiClient.sendMessage(communityId, userMessage.content);

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

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Side Panel */}
      <div
        className={`${
          isOpen ? 'flex' : 'hidden'
        } flex-col w-full lg:w-[420px] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 h-full`}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${communityColor} text-white`}>
              {communityIcon}
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">
                AI Assistant
              </h2>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {communityName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Close chat"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex items-center gap-2 p-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
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

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center px-4">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-3xl ${communityColor} text-white`}>
                  {communityIcon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  How can I help?
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Ask me anything about {communityName.toLowerCase()}
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
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${communityColor} text-white flex-shrink-0 mt-1`}>
                      {communityIcon}
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
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${communityColor} text-white`}>
                {communityIcon}
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
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm flex items-center gap-1"
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
    </>
  );
}
