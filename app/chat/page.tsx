'use client'

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { MessageSquare, ArrowUp, X } from 'lucide-react';
import { cn } from "@/lib/utils";

export default function ChatWindow() {
  const searchParams = useSearchParams();
  const initialQuestion = searchParams.get('q');
  const { getToken } = useAuth();
  
  const [messages, setMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  // Send initial question on mount
  useEffect(() => {
    if (initialQuestion) {
      sendMessage(initialQuestion);
    }
  }, [initialQuestion]);

  const sendMessage = async (userMessage: string) => {
    console.log('💬 Sending chat message:', userMessage);
    setIsLoading(true);
    setStreamingMessage('');
    
    const newMessages = [...messages, { role: 'user' as const, content: userMessage }];
    setMessages(newMessages);
    
    try {
      const token = await getToken({ skipCache: false });
      
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: newMessages,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      if (!response.body) {
        throw new Error('No response body');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          if (line.startsWith('0:')) {
            const jsonStr = line.substring(2).trim();
            if (jsonStr) {
              try {
                const data = JSON.parse(jsonStr);
                if (typeof data === 'string') {
                  fullResponse += data;
                  setStreamingMessage(fullResponse);
                }
              } catch (e) {
                console.warn('⚠️ Failed to parse chunk:', jsonStr);
              }
            }
          }
        }
      }
      
      setMessages([...newMessages, { role: 'assistant', content: fullResponse }]);
      setStreamingMessage('');
      
    } catch (err) {
      console.error('❌ Chat error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    sendMessage(input);
    setInput('');
  };

  const handleClose = async () => {
    // Close the window using Tauri API
    if (typeof window !== 'undefined') {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const window = getCurrentWindow();
        await window.close();
      } catch (error) {
        console.error('Failed to close window:', error);
      }
    }
  };

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Minimal Header with close button */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2 text-gray-600">
          <MessageSquare className="w-5 h-5" />
          <span className="text-sm font-medium">Chat</span>
        </div>
        <button
          onClick={handleClose}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex",
                message.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-5 py-3.5 text-base leading-relaxed shadow-sm",
                  message.role === 'user'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-50 text-gray-900 border border-gray-200'
                )}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
              </div>
            </div>
          ))}
          
          {streamingMessage && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-5 py-3.5 text-base leading-relaxed shadow-sm bg-gray-50 text-gray-900 border border-gray-200">
                <div className="whitespace-pre-wrap inline">{streamingMessage}</div>
                <span className="inline-block w-0.5 h-5 ml-0.5 bg-gray-900 animate-pulse" />
              </div>
            </div>
          )}
          
          {isLoading && !streamingMessage && (
            <div className="flex justify-start">
              <div className="bg-gray-50 text-gray-900 rounded-2xl px-5 py-3.5 text-base border border-gray-200">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area - Fixed at bottom */}
      <div className="border-t border-gray-200 bg-white px-6 py-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="relative flex items-center gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Ask a follow-up question..."
              className="flex-1 resize-none border border-gray-300 rounded-2xl px-4 py-3 text-base text-gray-900 placeholder-gray-500 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              rows={1}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="px-4 py-3 bg-black hover:bg-gray-800 text-white rounded-2xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

