'use client';

import { useState, useRef, useEffect } from 'react';

// TypeScript interfaces
interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  is_online?: boolean;
  last_seen?: string;
}

interface Message {
  id: number;
  content: string;
  sender_id: number;
  conversation_id: number;
  timestamp: string;
  sender?: User;
}

interface Conversation {
  id: number;
  name?: string;
  is_group: boolean;
  created_at: string;
  updated_at: string;
  last_message?: Message;
  participants?: User[];
  unread_count?: number;
}

// Helper to get current user from localStorage
const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
};

export default function MessengerView() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [wsConnection, setWsConnection] = useState<WebSocket | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  // API base URL
  const API_BASE = 'http://localhost:8002';

  // Get auth token
  const getAuthToken = () => {
    return localStorage.getItem('token');
  };

  // API headers
  const getHeaders = () => ({
    'Authorization': `Bearer ${getAuthToken()}`,
    'Content-Type': 'application/json'
  });

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays <= 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  // Load conversations
  const loadConversations = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/conversations`, {
        headers: getHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setConversations(data);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  // Load messages for a conversation
  const loadMessages = async (conversationId: number) => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/conversations/${conversationId}/messages`, {
        headers: getHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
        setTimeout(scrollToBottom, 100);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || !currentUser) return;

    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/conversations/${selectedConversation.id}/messages`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ content: newMessage.trim() })
      });

      if (response.ok) {
        const sentMessage = await response.json();
        setMessages(prev => [...prev, sentMessage]);
        setNewMessage('');
        scrollToBottom();
        
        // Update conversation list
        loadConversations();
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  // Search users
  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/users/search?q=${encodeURIComponent(query)}`, {
        headers: getHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
      }
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Start conversation with user
  const startConversation = async (userId: number) => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/conversations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ participant_ids: [userId] })
      });

      if (response.ok) {
        const conversation = await response.json();
        setConversations(prev => [conversation, ...prev]);
        setSelectedConversation(conversation);
        setMessages([]);
        setSearchQuery('');
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  };

  // WebSocket connection
  const connectWebSocket = () => {
    if (!currentUser) return;

    const ws = new WebSocket(`ws://localhost:8002/api/v1/messaging/ws/${currentUser.id}`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsConnection(ws);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'new_message') {
        // Add new message if it's for the current conversation
        if (selectedConversation && data.message.conversation_id === selectedConversation.id) {
          setMessages(prev => [...prev, data.message]);
          scrollToBottom();
        }
        
        // Update conversations list
        loadConversations();
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnection(null);
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };

  // Handle search input
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      searchUsers(value);
    } else {
      setSearchResults([]);
    }
  };

  // Handle message input
  const handleMessageInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  // Handle key press in message input
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Initialize component
  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      const user = getCurrentUser();
      setCurrentUser(user);
      
      if (user) {
        await loadConversations();
        connectWebSocket();
      }
      setLoading(false);
    };

    initialize();

    // Cleanup WebSocket on unmount
    return () => {
      if (wsConnection) {
        wsConnection.close();
      }
    };
  }, []);

  // Load messages when conversation is selected
  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
    }
  }, [selectedConversation]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Loading Messenger
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Setting up your conversations...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-gray-50 dark:bg-gray-900">
      {/* Conversations List */}
      <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-800">
        {/* Search */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <input
              type="text"
              placeholder="Search conversations or users..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-gray-100 dark:bg-gray-700 border-0 rounded-lg text-sm placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 dark:text-white"
            />
            <svg
              className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* Search Results */}
        {searchQuery && (
          <div className="flex-1 overflow-y-auto">
            {isSearching ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
                Searching...
              </div>
            ) : searchResults.length > 0 ? (
              <div>
                <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-700">
                  Users
                </div>
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => startConversation(user.id)}
                    className="w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                        {user.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">
                          {user.full_name}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          @{user.username}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                No users found for "{searchQuery}"
              </div>
            )}
          </div>
        )}

        {/* Conversations */}
        {!searchQuery && (
          <div className="flex-1 overflow-y-auto">
            {conversations.length > 0 ? (
              conversations.map((conversation) => {
                // Get conversation name from participants
                const otherParticipant = conversation.participants?.find(p => p.id !== currentUser?.id);
                const displayName = conversation.name || otherParticipant?.full_name || 'Unknown';
                
                return (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedConversation(conversation)}
                    className={`w-full p-3 border-b border-gray-100 dark:border-gray-700 text-left transition-colors ${
                      selectedConversation?.id === conversation.id
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-500 rounded-full flex items-center justify-center text-white font-medium">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-gray-900 dark:text-white truncate">
                            {displayName}
                          </div>
                          {conversation.last_message && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {formatTimestamp(conversation.last_message.timestamp)}
                            </div>
                          )}
                        </div>
                        {conversation.last_message && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {conversation.last_message.content}
                          </div>
                        )}
                        {conversation.unread_count && conversation.unread_count > 0 && (
                          <div className="text-xs bg-blue-600 text-white px-2 py-1 rounded-full mt-1 inline-block">
                            {conversation.unread_count}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.003 9.003 0 01-8.716-6.747M3 12c0-4.418 4.03-8 9-8a8.997 8.997 0 018.716 6.747M21 12H3" />
                  </svg>
                </div>
                <p className="text-sm font-medium">No conversations yet</p>
                <p className="text-xs mt-1">Search for users above to start a conversation</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center text-white font-medium">
                  {(() => {
                    const otherParticipant = selectedConversation.participants?.find(p => p.id !== currentUser?.id);
                    const displayName = selectedConversation.name || otherParticipant?.full_name || 'Unknown';
                    return displayName.charAt(0).toUpperCase();
                  })()}
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {(() => {
                      const otherParticipant = selectedConversation.participants?.find(p => p.id !== currentUser?.id);
                      return selectedConversation.name || otherParticipant?.full_name || 'Unknown';
                    })()}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {wsConnection ? 'Connected' : 'Connecting...'}
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-2 ${
                    message.sender_id === currentUser?.id ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.sender_id !== currentUser?.id && (
                    <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
                      {message.sender?.full_name?.charAt(0).toUpperCase() || '?'}
                    </div>
                  )}
                  
                  <div className={`max-w-[70%] rounded-lg px-3 py-2 ${
                    message.sender_id === currentUser?.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600'
                  }`}>
                    <div className="text-sm">{message.content}</div>
                    <div className={`text-xs mt-1 ${
                      message.sender_id === currentUser?.id ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {formatTimestamp(message.timestamp)}
                    </div>
                  </div>

                  {message.sender_id === currentUser?.id && (
                    <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
                      {currentUser.full_name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="flex gap-2">
                <textarea
                  ref={messageInputRef}
                  value={newMessage}
                  onChange={handleMessageInputChange}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  className="flex-1 resize-none border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm min-h-[40px] max-h-[120px]"
                  rows={1}
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm flex items-center gap-2"
                >
                  <span>Send</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.003 9.003 0 01-8.716-6.747M3 12c0-4.418 4.03-8 9-8a8.997 8.997 0 018.716 6.747M21 12H3" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Select a Conversation
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Choose a conversation from the list or search for users to start chatting
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
