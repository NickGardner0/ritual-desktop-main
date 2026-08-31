'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type OpenIndexChatOptions = {
  text?: string;
  focus?: boolean;
};

interface AIContextType {
  showAIChat: boolean;
  setShowAIChat: (show: boolean) => void;
  toggleAIChat: () => void;
  chatMode: 'log' | 'chat';
  setChatMode: (mode: 'log' | 'chat') => void;
  isFullScreenChat: boolean;
  setIsFullScreenChat: (isFullScreen: boolean) => void;
  indexChatOpen: boolean;
  indexChatEpoch: number;
  openIndexChat: (opts?: OpenIndexChatOptions) => void;
  closeIndexChat: () => void;
  takePendingIndexChatTexts: () => string[];
  takeIndexChatShouldFocus: () => boolean;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function AIProvider({ children }: { children: ReactNode }) {
  const [showAIChat, setShowAIChat] = useState(true); // Always show AI chat
  const [chatMode, setChatMode] = useState<'log' | 'chat'>('log');
  const [isFullScreenChat, setIsFullScreenChat] = useState(false);
  const [indexChatOpen, setIndexChatOpen] = useState(false);
  const [indexChatEpoch, setIndexChatEpoch] = useState(0);
  const pendingIndexChatTextsRef = useRef<string[]>([]);
  const indexChatShouldFocusRef = useRef(false);

  const toggleAIChat = useCallback(() => {
    setShowAIChat((current) => !current);
  }, []);

  const openIndexChat = useCallback((opts?: OpenIndexChatOptions) => {
    setIndexChatOpen(true);
    indexChatShouldFocusRef.current = opts?.focus ?? true;
    const text = opts?.text?.trim();
    if (!text) return;
    pendingIndexChatTextsRef.current.push(text);
    setIndexChatEpoch((current) => current + 1);
  }, []);

  const closeIndexChat = useCallback(() => {
    pendingIndexChatTextsRef.current = [];
    indexChatShouldFocusRef.current = false;
    setIndexChatOpen(false);
  }, []);

  const takePendingIndexChatTexts = useCallback(() => {
    const next = pendingIndexChatTextsRef.current;
    pendingIndexChatTextsRef.current = [];
    return next;
  }, []);

  const takeIndexChatShouldFocus = useCallback(() => {
    const next = indexChatShouldFocusRef.current;
    indexChatShouldFocusRef.current = false;
    return next;
  }, []);

  const value = useMemo<AIContextType>(() => ({
    showAIChat,
    setShowAIChat,
    toggleAIChat,
    chatMode,
    setChatMode,
    isFullScreenChat,
    setIsFullScreenChat,
    indexChatOpen,
    indexChatEpoch,
    openIndexChat,
    closeIndexChat,
    takePendingIndexChatTexts,
    takeIndexChatShouldFocus,
  }), [
    chatMode,
    closeIndexChat,
    indexChatEpoch,
    indexChatOpen,
    isFullScreenChat,
    openIndexChat,
    showAIChat,
    takeIndexChatShouldFocus,
    takePendingIndexChatTexts,
    toggleAIChat,
  ]);

  return (
    <AIContext.Provider value={value}>
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
