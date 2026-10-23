/**
 * Messaging API Service for UnifiedWork
 * Handles real-time messaging with WebSocket support
 */

interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  status: 'online' | 'away' | 'offline';
  last_seen?: string;
}

interface Message {
  id: number;
  content: string;
  message_type: string;
  sender_id: number;
  sender_username: string;
  sender_full_name: string;
  created_at: string;
  edited: boolean;
  edited_at?: string;
  reply_to_message_id?: number;
}

interface Conversation {
  id: number;
  name?: string;
  is_group: boolean;
  last_activity: string;
  participant_count: number;
  unread_count: number;
  last_message?: Message;
}

interface ConversationDetail {
  id: number;
  name?: string;
  is_group: boolean;
  participants: User[];
  messages: Message[];
  created_at: string;
}

interface CreateMessageRequest {
  content: string;
  message_type?: string;
  reply_to_message_id?: number;
}

interface CreateConversationRequest {
  participant_user_ids: number[];
  name?: string;
  is_group?: boolean;
}

class MessagingService {
  private baseUrl: string;
  private websocket: WebSocket | null = null;
  private messageHandlers: ((data: any) => void)[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor() {
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://api.unifiedwork.com' 
      : 'http://localhost:8002';
  }

  private getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  private async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // WebSocket connection
  connectWebSocket(userId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.baseUrl.replace('http', 'ws')}/api/v1/messaging/ws/${userId}`;
      
      this.websocket = new WebSocket(wsUrl);
      
      this.websocket.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      };
      
      this.websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.messageHandlers.forEach(handler => handler(data));
      };
      
      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
      
      this.websocket.onclose = () => {
        console.log('WebSocket disconnected');
        this.attemptReconnect(userId);
      };
    });
  }

  private attemptReconnect(userId: number) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connectWebSocket(userId).catch(console.error);
      }, Math.pow(2, this.reconnectAttempts) * 1000); // Exponential backoff
    }
  }

  disconnectWebSocket() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  onMessage(handler: (data: any) => void) {
    this.messageHandlers.push(handler);
  }

  offMessage(handler: (data: any) => void) {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  sendTypingIndicator(conversationId: number, isTyping: boolean) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'typing',
        conversation_id: conversationId,
        is_typing: isTyping
      }));
    }
  }

  // API Methods
  async getConversations(): Promise<Conversation[]> {
    return this.apiRequest<Conversation[]>('/api/v1/messaging/conversations');
  }

  async getConversationDetail(conversationId: number): Promise<ConversationDetail> {
    return this.apiRequest<ConversationDetail>(`/api/v1/messaging/conversations/${conversationId}`);
  }

  async createConversation(request: CreateConversationRequest): Promise<ConversationDetail> {
    return this.apiRequest<ConversationDetail>('/api/v1/messaging/conversations', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async sendMessage(conversationId: number, request: CreateMessageRequest): Promise<Message> {
    return this.apiRequest<Message>(`/api/v1/messaging/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async searchUsers(query: string): Promise<User[]> {
    return this.apiRequest<User[]>(`/api/v1/messaging/users/search?q=${encodeURIComponent(query)}`);
  }

  async getPresence(): Promise<User[]> {
    return this.apiRequest<User[]>('/api/v1/messaging/presence');
  }
}

// Create a singleton instance
const messagingService = new MessagingService();

export default messagingService;
export type {
  User,
  Message, 
  Conversation,
  ConversationDetail,
  CreateMessageRequest,
  CreateConversationRequest
};
