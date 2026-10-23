'use client';

import { useChat } from '../contexts/ChatContext';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface ChatAwareLayoutProps {
  children: React.ReactNode;
}

export default function ChatAwareLayout({ children }: ChatAwareLayoutProps) {
  const { isOpen, closeChat } = useChat();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();
  
  // Close chat when navigating to non-community pages
  useEffect(() => {
    // Close chat if not on a community page
    if (!pathname.startsWith('/community/')) {
      closeChat();
    }
  }, [pathname, closeChat]);
  
  // Listen for collapse state changes from the sidebar
  useEffect(() => {
    const handleCollapseChange = (e: CustomEvent) => {
      setIsCollapsed(e.detail.isCollapsed);
    };

    window.addEventListener('chatCollapseChanged' as any, handleCollapseChange);
    return () => window.removeEventListener('chatCollapseChanged' as any, handleCollapseChange);
  }, []);
  
  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}
