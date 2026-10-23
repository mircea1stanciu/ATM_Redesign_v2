'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';

// TypeScript interfaces
interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  is_online?: boolean;
  last_seen?: string;
}

interface FileAttachment {
  id: number;
  filename: string;
  original_filename: string;
  file_size: number;
  content_type: string;
  upload_url: string;
}

interface Message {
  id: number;
  content: string;
  sender_id: number;
  conversation_id: number;
  timestamp: string;
  sender?: User;
  attachments?: FileAttachment[];
  reactions?: { [emoji: string]: { user_id: number; username: string }[] };
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
  const { closeChat } = useChat();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [organizationUsers, setOrganizationUsers] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [wsConnection, setWsConnection] = useState<WebSocket | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'ai' | 'conversations' | 'users'>('ai');
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Handle close chat
  const handleCloseChat = () => {
    closeChat();
  };

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

  // Load organization users
  const loadOrganizationUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/users`, {
        headers: getHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setOrganizationUsers(data);
      }
    } catch (error) {
      console.error('Error loading organization users:', error);
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
    // If file is selected, send with file
    if (selectedFile) {
      await sendMessageWithFile(selectedFile, newMessage.trim());
      return;
    }

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
        body: JSON.stringify({ participant_user_ids: [userId] })
      });

      if (response.ok) {
        const conversation = await response.json();
        setConversations(prev => [conversation, ...prev]);
        setSelectedConversation(conversation);
        setMessages([]);
        setSearchQuery('');
        setSearchResults([]);
        setActiveTab('conversations'); // Switch to conversations tab
      } else {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        console.error('Error starting conversation:', response.status, error);
        alert(`Failed to start conversation: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error starting conversation:', error);
      alert('Failed to start conversation. Please try again.');
    }
  };

  // Delete conversation
  const deleteConversation = async (conversationId: number) => {
    if (!confirm('Are you sure you want to delete this conversation?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });

      if (response.ok) {
        // Remove from conversations list
        setConversations(prev => prev.filter(c => c.id !== conversationId));
        
        // Clear selection if this conversation was selected
        if (selectedConversation?.id === conversationId) {
          setSelectedConversation(null);
          setMessages([]);
        }
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  // Create group conversation
  const createGroupConversation = async () => {
    if (selectedUsers.length < 2 || !groupName.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/conversations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          participant_user_ids: selectedUsers.map(user => user.id),
          name: groupName.trim(),
          is_group: true
        })
      });

      if (response.ok) {
        const conversation = await response.json();
        setConversations(prev => [conversation, ...prev]);
        setSelectedConversation(conversation);
        setMessages([]);
        setShowGroupModal(false);
        setSelectedUsers([]);
        setGroupName('');
        setActiveTab('conversations');
      }
    } catch (error) {
      console.error('Error creating group:', error);
    }
  };

  // Toggle user selection for group creation
  const toggleUserSelection = (user: User) => {
    setSelectedUsers(prev => 
      prev.find(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
  };

  // File upload functions
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      generateFilePreview(file);
    }
  };

  // Generate preview URL for images
  const generateFilePreview = (file: File) => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFilePreviewUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreviewUrl(null);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      setSelectedFile(file);
      generateFilePreview(file);
    }
  };

  const uploadFile = async (file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/api/v1/messaging/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error('File upload failed');
    }

    return response.json();
  };

  const sendMessageWithFile = async (file: File, messageText: string = '') => {
    if (!selectedConversation || !currentUser) return;

    setIsUploading(true);
    try {
      // Upload file first
      const fileInfo = await uploadFile(file);

      // Send message with file attachment
      const response = await fetch(`${API_BASE}/api/v1/messaging/conversations/${selectedConversation.id}/messages/with-file`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          content: messageText,
          file_info: fileInfo
        })
      });

      if (response.ok) {
        const sentMessage = await response.json();
        setMessages(prev => [...prev, sentMessage]);
        setNewMessage('');
        setSelectedFile(null);
        setFilePreviewUrl(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        scrollToBottom();
        
        // Update conversation list
        loadConversations();
      }
    } catch (error) {
      console.error('Error sending file:', error);
      alert('Failed to send file. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (contentType: string): string => {
    if (contentType.startsWith('image/')) return '🖼️';
    if (contentType.startsWith('video/')) return '🎥';
    if (contentType.startsWith('audio/')) return '🎵';
    if (contentType.includes('pdf')) return '📄';
    if (contentType.includes('document') || contentType.includes('docx')) return '📝';
    if (contentType.includes('spreadsheet') || contentType.includes('xlsx')) return '📊';
    if (contentType.includes('zip') || contentType.includes('rar')) return '📦';
    return '📎';
  };

  // Reaction functions
  const addReaction = async (messageId: number, emoji: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/messaging/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ emoji })
      });

      if (response.ok) {
        const result = await response.json();
        // Update will come through WebSocket, but we can also update locally
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, reactions: result.reactions }
            : msg
        ));
      }
    } catch (error) {
      console.error('Error adding reaction:', error);
    }
  };

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😠'];

  const getReactionSummary = (reactions: { [emoji: string]: { user_id: number; username: string }[] }) => {
    const summary: { emoji: string; count: number; users: string[]; hasCurrentUser: boolean }[] = [];
    
    Object.entries(reactions).forEach(([emoji, users]) => {
      if (users.length > 0) {
        summary.push({
          emoji,
          count: users.length,
          users: users.map(u => u.username),
          hasCurrentUser: users.some(u => u.user_id === currentUser?.id)
        });
      }
    });
    
    return summary;
  };

  // WebSocket connection
  const connectWebSocket = (user?: User) => {
    const userToConnect = user || currentUser;
    if (!userToConnect) return;

    const ws = new WebSocket(`ws://localhost:8002/api/v1/messaging/ws/${userToConnect.id}`);
    
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
      } else if (data.type === 'user_status_changed') {
        // Refresh organization users when someone's status changes
        loadOrganizationUsers();
      } else if (data.type === 'conversation_created') {
        // Reload conversations list when a new conversation is created
        console.log('New conversation created:', data.conversation_id);
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
        await loadOrganizationUsers();
        connectWebSocket(user);  // Pass user directly!
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
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Persistent Close Button Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">Chat</div>
        <button
          onClick={handleCloseChat}
          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          title="Close chat"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversations List */}
        <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-800">
        {/* Search */}
        <div className="p-2 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 bg-gray-100 dark:bg-gray-700 border-0 rounded-lg text-xs placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 dark:text-white"
            />
            <svg
              className="absolute left-2 top-1.5 w-3 h-3 text-gray-400"
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

        {/* Tab Navigation */}
        {!searchQuery && (
          <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div className="flex">
              <button
                onClick={() => setActiveTab('ai')}
                className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  activeTab === 'ai'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-700'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                🤖 AI Assistant
              </button>
              <button
                onClick={() => setActiveTab('conversations')}
                className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  activeTab === 'conversations'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-700'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                💬 Chat
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  activeTab === 'users'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-700'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                👥 Team
              </button>
            </div>
            {/* Create Group Button */}
            {activeTab === 'conversations' && (
              <div className="px-2 py-1 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setShowGroupModal(true)}
                  className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-medium transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Group
                </button>
              </div>
            )}
          </div>
        )}

        {/* Search Results */}
        {searchQuery && (
          <div className="flex-1 overflow-y-auto">
            {isSearching ? (
              <div className="p-2 text-center text-gray-500 dark:text-gray-400">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mx-auto mb-1"></div>
                <span className="text-xs">Searching...</span>
              </div>
            ) : searchResults.length > 0 ? (
              <div>
                <div className="px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-700">
                  Users
                </div>
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => startConversation(user.id)}
                    className="w-full px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 text-left transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                        {user.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
                          {user.full_name}
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          @{user.username}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-2 text-center text-xs text-gray-500 dark:text-gray-400">
                No users found for "{searchQuery}"
              </div>
            )}
          </div>
        )}

        {/* Main Content - Conversations or Users */}
        {!searchQuery && (
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'conversations' ? (
              /* Conversations Tab */
              conversations.length > 0 ? (
                conversations.map((conversation) => {
                  // Get conversation name from participants
                  const otherParticipant = conversation.participants?.find(p => p.id !== currentUser?.id);
                  const displayName = conversation.is_group 
                    ? conversation.name || 'Group Chat' 
                    : otherParticipant?.full_name || 'Unknown';
                  const memberCount = conversation.participants?.length || 0;
                  
                  return (
                    <div
                      key={conversation.id}
                      className={`w-full px-2 py-1.5 border-b border-gray-100 dark:border-gray-700 transition-colors group ${
                        selectedConversation?.id === conversation.id
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSelectedConversation(conversation)}
                          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                            conversation.is_group 
                              ? 'bg-gradient-to-br from-purple-500 to-pink-600' 
                              : 'bg-gray-500'
                          }`}>
                            {conversation.is_group ? '👥' : displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                                {displayName}
                                {conversation.is_group && (
                                  <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">
                                    ({memberCount})
                                  </span>
                                )}
                              </div>
                              {conversation.last_message && (
                                <div className="text-[9px] text-gray-500 dark:text-gray-400 flex-shrink-0">
                                  {formatTimestamp(conversation.last_message.timestamp)}
                                </div>
                              )}
                            </div>
                            {conversation.last_message && (
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                                {conversation.last_message.content}
                              </div>
                            )}
                            {conversation.unread_count && conversation.unread_count > 0 && (
                              <div className="text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full mt-0.5 inline-block">
                                {conversation.unread_count}
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(conversation.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded"
                          title="Delete conversation"
                        >
                          <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
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
                  <p className="text-xs mt-1">Start chatting with your teammates!</p>
                </div>
              )
            ) : (
              /* Users Tab */
              organizationUsers.length > 0 ? (
                organizationUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => startConversation(user.id)}
                    className="w-full px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 text-left transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-shrink-0">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                          {user.full_name.charAt(0).toUpperCase()}
                        </div>
                        {/* Online status indicator */}
                        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 ${
                          user.is_online ? 'bg-green-500' : 'bg-gray-400'
                        }`}></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                            {user.full_name}
                          </div>
                          <div className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                            user.is_online 
                              ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400' 
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }`}>
                            {user.is_online ? 'Online' : 'Offline'}
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          @{user.username}
                        </div>
                        {!user.is_online && user.last_seen && (
                          <div className="text-[9px] text-gray-400 dark:text-gray-500">
                            Last seen {formatTimestamp(user.last_seen)}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium">No team members found</p>
                  <p className="text-xs mt-1">Invite more people to your organization!</p>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0 ${
                  selectedConversation.is_group 
                    ? 'bg-gradient-to-br from-purple-500 to-pink-600' 
                    : 'bg-gray-500'
                }`}>
                  {selectedConversation.is_group ? '👥' : (() => {
                    const otherParticipant = selectedConversation.participants?.find(p => p.id !== currentUser?.id);
                    const displayName = selectedConversation.name || otherParticipant?.full_name || 'Unknown';
                    return displayName.charAt(0).toUpperCase();
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                    {(() => {
                      const otherParticipant = selectedConversation.participants?.find(p => p.id !== currentUser?.id);
                      const displayName = selectedConversation.is_group 
                        ? selectedConversation.name || 'Group Chat' 
                        : otherParticipant?.full_name || 'Unknown';
                      return displayName;
                    })()}
                    {selectedConversation.is_group && (
                      <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">
                        ({selectedConversation.participants?.length || 0})
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    {selectedConversation.is_group 
                      ? `Group • ${wsConnection ? 'Connected' : 'Connecting...'}`
                      : (wsConnection ? 'Connected' : 'Connecting...')
                    }
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-1 ${
                    message.sender_id === currentUser?.id ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.sender_id !== currentUser?.id && (
                    <div className="w-6 h-6 bg-gray-500 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                      {message.sender?.full_name?.charAt(0).toUpperCase() || '?'}
                    </div>
                  )}
                  
                  <div className={`max-w-[70%] rounded px-2 py-1 text-xs ${
                    message.sender_id === currentUser?.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600'
                  }`}>
                    {/* Message content */}
                    {message.content && (
                      <div>{message.content}</div>
                    )}
                    
                    {/* File attachments */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className={`${message.content ? 'mt-1' : ''} space-y-1`}>
                        {message.attachments.map((attachment, index) => (
                          <div
                            key={index}
                            className={`flex items-center gap-1.5 p-1 rounded text-[9px] border ${
                              message.sender_id === currentUser?.id
                                ? 'bg-blue-700 border-blue-500'
                                : 'bg-gray-50 dark:bg-gray-600 border-gray-200 dark:border-gray-500'
                            }`}
                          >
                            <span className="text-sm">
                              {getFileIcon(attachment.content_type)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {attachment.original_filename}
                              </div>
                              <div className={`text-[8px] ${
                                message.sender_id === currentUser?.id ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                              }`}>
                                {formatFileSize(attachment.file_size)}
                              </div>
                            </div>
                            <a
                              href={`${API_BASE}${attachment.upload_url}`}
                              download={attachment.original_filename}
                              className={`p-0.5 rounded hover:bg-opacity-80 transition-colors flex-shrink-0 ${
                                message.sender_id === currentUser?.id
                                  ? 'text-blue-100 hover:bg-blue-800'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-500'
                              }`}
                              title="Download file"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div className={`text-[8px] mt-0.5 ${
                      message.sender_id === currentUser?.id ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {formatTimestamp(message.timestamp)}
                    </div>

                    {/* Reactions Display */}
                    {message.reactions && Object.keys(message.reactions).length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {getReactionSummary(message.reactions).map((reaction) => (
                          <button
                            key={reaction.emoji}
                            onClick={() => addReaction(message.id, reaction.emoji)}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium transition-colors ${
                              reaction.hasCurrentUser
                                ? message.sender_id === currentUser?.id
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-blue-200 text-blue-900 dark:bg-blue-600 dark:text-white'
                                : message.sender_id === currentUser?.id
                                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-500'
                            }`}
                            title={reaction.users.join(', ')}
                          >
                            <span>{reaction.emoji}</span>
                            <span>{reaction.count}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Quick Reaction Buttons */}
                    <div className="flex gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => addReaction(message.id, emoji)}
                          className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                            message.sender_id === currentUser?.id
                              ? 'hover:bg-blue-700'
                              : ''
                          }`}
                          title={`React with ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
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
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`p-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-colors ${
                isDraggingFile ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400' : ''
              }`}>
              {/* File preview */}
              {selectedFile && (
                <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-start gap-1.5 flex-1">
                      {/* Image thumbnail preview */}
                      {filePreviewUrl && (
                        <img 
                          src={filePreviewUrl} 
                          alt="preview" 
                          className="w-8 h-8 object-cover rounded border border-gray-300 dark:border-gray-500"
                        />
                      )}
                      {!filePreviewUrl && (
                        <span className="text-lg">{getFileIcon(selectedFile.type)}</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
                          {selectedFile.name}
                        </div>
                        <div className="text-[9px] text-gray-500 dark:text-gray-400">
                          {formatFileSize(selectedFile.size)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedFile(null);
                        setFilePreviewUrl(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded flex-shrink-0"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-1">
                {/* File attachment button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                  title="Attach file"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>

                <textarea
                  ref={messageInputRef}
                  value={newMessage}
                  onChange={handleMessageInputChange}
                  onKeyPress={handleKeyPress}
                  placeholder={selectedFile ? "Add a message..." : "Type a message..."}
                  className="flex-1 resize-none border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-xs min-h-[32px] max-h-[80px]"
                  rows={1}
                />
                
                <button
                  onClick={sendMessage}
                  disabled={(!newMessage.trim() && !selectedFile) || isUploading}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded font-medium transition-colors text-xs flex items-center gap-1 flex-shrink-0"
                >
                  {isUploading ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                      <span className="hidden sm:inline">Send</span>
                    </>
                  ) : (
                    <>
                      <span className="hidden sm:inline">Send</span>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </>
                  )}
                </button>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept=".txt,.pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp4,.mov,.avi,.zip,.rar"
                className="hidden"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-4">
              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-2">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.003 9.003 0 01-8.716-6.747M3 12c0-4.418 4.03-8 9-8a8.997 8.997 0 018.716 6.747M21 12H3" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                Select a Conversation
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Choose a chat or search for users
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Group Creation Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded p-3 w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Create Group
              </h3>
              <button
                onClick={() => {
                  setShowGroupModal(false);
                  setSelectedUsers([]);
                  setGroupName('');
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Group Name Input */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name..."
                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            {/* User Selection */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Members ({selectedUsers.length})
              </label>
              <div className="max-h-40 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded">
                {organizationUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => toggleUserSelection(user)}
                    className={`w-full px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0 transition-colors text-xs ${
                      selectedUsers.find(u => u.id === user.id) 
                        ? 'bg-blue-50 dark:bg-blue-900/20' 
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-shrink-0">
                        <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                          {user.full_name.charAt(0).toUpperCase()}
                        </div>
                        {selectedUsers.find(u => u.id === user.id) && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full flex items-center justify-center">
                            <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {user.full_name}
                        </div>
                        <div className="text-[9px] text-gray-500 dark:text-gray-400">
                          @{user.username}
                        </div>
                      </div>
                      <div className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${
                        user.is_online 
                          ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400' 
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {user.is_online ? 'On' : 'Off'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowGroupModal(false);
                  setSelectedUsers([]);
                  setGroupName('');
                }}
                className="flex-1 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createGroupConversation}
                disabled={selectedUsers.length < 2 || !groupName.trim()}
                className="flex-1 px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
