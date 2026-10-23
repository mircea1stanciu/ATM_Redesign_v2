'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type ChatTab = 'ai' | 'messenger';

interface ChatContextType {
  isOpen: boolean;
  openChat: (communityId?: string) => void;
  closeChat: () => void;
  toggleChat: () => void;
  activeCommunityId: string | null;
  setActiveCommunityId: (id: string | null) => void;
  activeTab: ChatTab;
  setActiveTab: (tab: ChatTab) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ChatTab>('ai');
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Load chat preferences from localStorage (but NOT isOpen - chat should start closed)
  useEffect(() => {
    if (!isClient) return;
    
    const savedState = localStorage.getItem('chatState');
    if (savedState) {
      try {
        const { 
          activeCommunityId: savedCommunityId,
          activeTab: savedActiveTab
        } = JSON.parse(savedState);
        setActiveCommunityId(savedCommunityId || null);
        setActiveTab(savedActiveTab || 'ai');
      } catch (e) {
        console.error('Error loading chat state:', e);
      }
    }
  }, [isClient]);

  // Save chat preferences to localStorage (but NOT isOpen - chat always starts closed)
  useEffect(() => {
    if (!isClient) return;
    
    localStorage.setItem('chatState', JSON.stringify({
      activeCommunityId,
      activeTab
    }));
  }, [isClient, activeCommunityId, activeTab]);

  const openChat = (communityId?: string) => {
    setIsOpen(true);
    if (communityId) {
      setActiveCommunityId(communityId);
      setActiveTab('ai'); // Default to AI tab when opening from community
    }
  };
  const closeChat = () => setIsOpen(false);
  const toggleChat = () => setIsOpen(prev => !prev);

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        openChat,
        closeChat,
        toggleChat,
        activeCommunityId,
        setActiveCommunityId,
        activeTab,
        setActiveTab
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
