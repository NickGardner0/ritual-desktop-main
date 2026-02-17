'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface AIContextType {
  showAIChat: boolean;
  setShowAIChat: (show: boolean) => void;
  toggleAIChat: () => void;
  chatMode: 'log' | 'chat';
  setChatMode: (mode: 'log' | 'chat') => void;
  isFullScreenChat: boolean;
  setIsFullScreenChat: (isFullScreen: boolean) => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function AIProvider({ children }: { children: ReactNode }) {
  const [showAIChat, setShowAIChat] = useState(true); // Always show AI chat
  const [chatMode, setChatMode] = useState<'log' | 'chat'>('log');
  const [isFullScreenChat, setIsFullScreenChat] = useState(false);

  const toggleAIChat = () => {
    setShowAIChat(!showAIChat);
  };

  return (
    <AIContext.Provider value={{ showAIChat, setShowAIChat, toggleAIChat, chatMode, setChatMode, isFullScreenChat, setIsFullScreenChat }}>
      {children}
    </AIContext.Provider>
  );
}

export function useAI() {
  const context = useContext(AIContext);
  if (context === undefined) {
    throw new Error('useAI must be used within an AIProvider');
  }
  return context;
}
