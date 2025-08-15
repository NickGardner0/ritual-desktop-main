'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Sidebar } from "@mynaui/icons-react"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChat } from 'ai/react'
import { useToast } from "@/components/ui/use-toast"

const SUGGESTED_QUESTIONS = [
  "What's my current streak?",
  "How am I doing this week?",
  "What is my spending on habits?",
  "Find a habit to improve",
]

const USER_DATA = {
  name: 'Nick',
  currentStreak: 7,
  completionRate: 87,
  habits: [],
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatHistory {
  id: string
  title: string
  date: Date
  preview: string
}

const SAMPLE_CHAT_HISTORY: ChatHistory[] = [
  {
    id: '1',
    title: "What's my revenue",
    date: new Date(),
    preview: "Here's your revenue breakdown..."
  },
  {
    id: '2',
    title: "Show transactions without receipts",
    date: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
    preview: "Here are your transactions..."
  },
  {
    id: '3',
    title: "Recurring transactions",
    date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), // 6 days ago
    preview: "Here are your recurring transactions..."
  }
]

interface Props {
  open: boolean
  onClose: () => void
}

const RitualLogo = () => (
  <div className="text-black">
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M0 20C0 8.954 8.954 0 20 0c8.121 0 15.112 4.84 18.245 11.794l-26.45 26.45a20 20 0 0 1-3.225-1.83L24.984 20H20L5.858 34.142A19.94 19.94 0 0 1 0 20M39.999 20.007 20.006 40c11.04-.004 19.99-8.953 19.993-19.993"
      />
    </svg>
  </div>
)

export function ChatAssistantWidget({ open, onClose }: Props) {
  const { toast } = useToast()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);
  
  const { messages, input, handleInputChange, handleSubmit, isLoading, error, setMessages, setInput } = useChat({
    api: '/api/chat',
    initialMessages: [
      {
        id: '1',
        role: 'assistant',
        content: `Hi ${USER_DATA.name}, how can I help you today?`,
      }
    ],
    onError: (error) => {
      console.error('Chat Error:', error)
      toast({
        title: "Chat Error",
        description: error.message === "Failed to fetch" 
          ? "Unable to connect to the chat service. Please check your API key configuration."
          : error.message || "Failed to send message. Please try again.",
        variant: "destructive",
      })
    },
    onFinish: () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    }
  })

  // Reset messages and input when chat is closed
  useEffect(() => {
    if (!open) {
      setMessages([
        {
          id: '1',
          role: 'assistant',
          content: `Hi ${USER_DATA.name}, how can I help you today?`,
        }
      ])
      setInput('')
    }
  }, [open, setMessages, setInput])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown)
      }
    };
  }, [onClose])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleQuestionClick = (question: string) => {
    const formEvent = new Event('submit', { cancelable: true }) as any
    handleSubmit(formEvent)
    handleInputChange({ target: { value: question } } as any)
  }

  const groupChatsByDate = (chats: ChatHistory[]) => {
    const today = new Date()
    const todayChats = chats.filter(chat => 
      chat.date.toDateString() === today.toDateString()
    )
    
    const last7DaysChats = chats.filter(chat => {
      const chatDate = chat.date
      const isWithinLast7Days = chatDate > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      return isWithinLast7Days && chatDate.toDateString() !== today.toDateString()
    })

    return { todayChats, last7DaysChats }
  }

  const { todayChats, last7DaysChats } = groupChatsByDate(SAMPLE_CHAT_HISTORY)

  // Drag event handlers
  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setDragging(true);
    const rect = widgetRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
    e.preventDefault();
  };
  const handleDrag = (e: MouseEvent) => {
    if (!dragging) return;
    const newX = Math.max(e.clientX - dragOffset.current.x, 120);
    const newY = Math.max(e.clientY - dragOffset.current.y, 0);
    setPosition({
      x: newX,
      y: newY,
    });
  };
  const handleDragEnd = () => setDragging(false);
  useEffect(() => {
    if (dragging) {
      if (typeof window !== 'undefined') {
        window.addEventListener('mousemove', handleDrag);
        window.addEventListener('mouseup', handleDragEnd);
      }
    } else {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', handleDragEnd);
      }
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', handleDragEnd);
      }
    };
  }, [dragging]);

  // Set a default position if at (0,0)
  useEffect(() => {
    if (open && position.x === 0 && position.y === 0) {
      setPosition({ x: 120, y: 60 }); // 120px to clear sidebar and button
    }
    // eslint-disable-next-line
  }, [open]);

  // Prevent dragging past the left edge of the sidebar
  const SIDEBAR_WIDTH = 72; // collapsed width
  const SIDEBAR_PADDING = 48; // extra space for collapse button
  const MIN_LEFT = SIDEBAR_WIDTH + SIDEBAR_PADDING;

  return (
    <>
      {open && (
        <div 
          ref={widgetRef}
          className="fixed z-50 w-full max-w-[720px] h-[450px] bg-white shadow-2xl flex flex-col overflow-hidden"
          style={{
            left: position.x,
            top: position.y,
            cursor: dragging ? 'grabbing' : 'default',
            zIndex: 1000,
            willChange: 'transform',
            pointerEvents: 'auto',
            border: '1px solid #D1D5DB',
          }}
        >
          {/* Drag handle */}
          <div
            className="w-full h-8 cursor-grab z-20 flex items-center px-4 select-none group"
            onMouseDown={handleDragStart}
          >
            {/* Sidebar toggle button, now in header */}
            <button
              onClick={e => { e.stopPropagation(); setIsSidebarOpen(!isSidebarOpen); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 mr-2"
              style={{ outline: 'none' }}
              aria-label="Toggle chat history sidebar"
            >
              <Sidebar className={`w-5 h-5 transition-colors ${isSidebarOpen ? 'text-black' : 'text-gray-500'}`} />
            </button>
            <span className="text-base font-normal text-gray-400 transition-colors group-hover:text-gray-700">Assistant</span>
            <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700">ESC</button>
          </div>
          {/* Separator below header */}
          <div style={{height: '1px', background: '#D1D5DB', width: '100%'}} />

          {/* Content area: sidebar + main chat area */}
          <div className="flex flex-1 min-h-0">
            {/* Chat History Sidebar */}
            {isSidebarOpen && (
              <div
                className="border-r border-gray-300 shadow-sm h-full bg-[#fafaf9] overflow-hidden w-[250px] animate-in slide-in-from-left duration-200"
              >
                <div className="p-4">
                  <button
                    onClick={() => {
                      handleQuestionClick(`Hi ${USER_DATA.name}, how can I help you today?`)
                    }}
                    className="w-full px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-300 shadow-sm hover:bg-gray-50 flex items-center gap-2"
                  >
                    <span>New chat</span>
                  </button>
                </div>
                
                <div className="px-3">
                  {todayChats.length > 0 && (
                    <>
                      <h3 className="px-3 mb-2 text-sm font-medium text-gray-500">Today</h3>
                      {todayChats.map(chat => (
                        <button
                          key={chat.id}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 rounded-lg hover:bg-gray-100"
                        >
                          {chat.title}
                        </button>
                      ))}
                    </>
                  )}

                  {last7DaysChats.length > 0 && (
                    <>
                      <h3 className="px-3 mt-4 mb-2 text-sm font-medium text-gray-500">Last 7 days</h3>
                      {last7DaysChats.map(chat => (
                        <button
                          key={chat.id}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 rounded-lg hover:bg-gray-100"
                        >
                          {chat.title}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Only render the chat messages and input area below */}
              <div className="flex-1 flex flex-col overflow-y-auto px-4 py-5">
                {messages.length === 1 ? (
                  <div className="flex flex-1 flex-col items-center justify-center">
                    <div className="w-8 h-8 mx-auto mb-4">
                      <RitualLogo />
                    </div>
                    <p className="text-xl font-medium text-center mb-8">
                      Hi Nick, how can I help<br />
                      you today?
                    </p>
                  </div>
                ) : (
                  <div className="w-full space-y-5">
                    {messages.map((message) => (
                      <div key={message.id} className="flex items-start">
                        {message.role === 'assistant' ? (
                          <div className="w-7 h-7 mr-3 flex-shrink-0">
                            <RitualLogo />
                          </div>
                        ) : (
                          <div className="w-7 h-7 mr-3 flex-shrink-0">
                            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm">
                              N
                            </div>
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-sm leading-relaxed">{message.content}</p>
                        </div>
                      </div>
                    ))}
                    {isLoading && (
                      <div className="flex items-start">
                        <div className="w-7 h-7 mr-3 flex-shrink-0">
                          <RitualLogo />
                        </div>
                        <div className="flex-1">
                          <div className="w-6 h-6 animate-spin">
                            <RitualLogo />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
              {/* Suggested Questions */}
              <div className="shadow-sm flex flex-col">
                {/* Suggested Questions at the bottom above the search box */}
                <div className="overflow-x-auto px-4 py-3 no-scrollbar">
                  <div className="flex gap-3 w-max">
                    {SUGGESTED_QUESTIONS.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => handleQuestionClick(q)}
                        className="px-4 py-2 text-sm text-gray-600 bg-[#fafaf9] rounded-md hover:bg-gray-100 transition-colors whitespace-nowrap flex-shrink-0 border border-gray-200 shadow-sm"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Separator between suggestions and input */}
                <div style={{height: '1px', background: '#D1D5DB', width: '100%', marginTop: '4px'}} />
                {/* Input */}
                <div className="px-4 py-1.5">
                  <form
                    onSubmit={handleSubmit}
                    className="flex items-center"
                  >
                    <div className="w-5 h-5 mr-3">
                      <RitualLogo />
                    </div>
                    <Input
                      value={input}
                      onChange={handleInputChange}
                      placeholder="Ask Ritual a question..."
                      className="flex-1 border-0 focus-visible:ring-0 px-0 py-1 text-sm bg-transparent rounded-none"
                      disabled={isLoading}
                    />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      disabled={isLoading}
                      className="h-8 w-8 hover:bg-transparent focus:bg-transparent active:bg-transparent [&:hover]:bg-transparent rounded-none"
                    >
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
