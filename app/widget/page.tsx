'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Play, Pause, X, ChevronDown } from 'lucide-react'
import { useHabits } from '@/contexts/HabitsContext'

export default function WidgetPage() {
  const [time, setTime] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [selectedHabit, setSelectedHabit] = useState('Focus')
  const [showHabitSelector, setShowHabitSelector] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Get habits from context
  const { customHabits } = useHabits()
  
  // Debug: Log component mount and state changes
  useEffect(() => {
    console.log('🔧 WidgetPage component mounted!');
    console.log('🔧 Initial state - showHabitSelector:', showHabitSelector);
    console.log('🔧 Initial customHabits:', customHabits);
  }, [])
  
  useEffect(() => {
    console.log('🔄 showHabitSelector changed to:', showHabitSelector);
  }, [showHabitSelector])

  // Set default habit from available habits
  useEffect(() => {
    console.log('📋 Available habits:', customHabits);
    if (customHabits.length > 0 && selectedHabit === 'Focus') {
      console.log('🎯 Setting default habit to:', customHabits[0].label);
      setSelectedHabit(customHabits[0].label)
    }
  }, [customHabits, selectedHabit])

  // Close habit selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showHabitSelector && !target?.closest('.habit-selector')) {
        setShowHabitSelector(false)
      }
    }

    if (showHabitSelector) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showHabitSelector])

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTime(prev => prev + 1)
      }, 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isRunning])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handlePlayPause = () => {
    setIsRunning(!isRunning)
  }

  const handleClose = () => {
    if (typeof window !== 'undefined') {
      // Try to close the Tauri window
      try {
        import('@tauri-apps/api/window').then(({ getCurrent }) => {
          getCurrent().close()
        })
      } catch {
        window.close()
      }
    }
  }

  const handleComplete = () => {
    setIsRunning(false)
    if (typeof window !== 'undefined') {
      alert(`✅ Session completed! ${formatTime(time)} of ${selectedHabit}`)
    }
    setTime(0)
  }

  const handleHabitSelect = (habitLabel: string) => {
    console.log('🎯 Selecting habit:', habitLabel);
    setSelectedHabit(habitLabel)
    setShowHabitSelector(false)
  }

  // Resize window when dropdown opens/closes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const resizeWindow = async () => {
        try {
          const { getCurrent } = await import('@tauri-apps/api/window');
          const currentWindow = getCurrent();
          
          if (showHabitSelector) {
            // Expand window height to show dropdown
            await currentWindow.setSize({ width: 320, height: 200 });
          } else {
            // Contract back to normal size
            await currentWindow.setSize({ width: 320, height: 50 });
          }
        } catch (error) {
          console.log('Window resize not available:', error);
        }
      };
      
      resizeWindow();
    }
  }, [showHabitSelector])

            return (
    <div className="w-full h-full relative" style={{ background: 'transparent' }}>
      {/* Dropdown positioned below the main widget */}
      {showHabitSelector && (
        <div 
          style={{
            position: 'absolute',
            top: '60px', // Position below the main widget
            left: '0px',
            right: '0px',
            background: 'white',
            border: '2px solid #007AFF',
            borderRadius: '8px',
            zIndex: 999999,
            padding: '10px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '8px', color: 'black', fontSize: '12px' }}>
            SELECT HABIT:
          </div>
          {customHabits.map((habit, i) => (
            <div 
              key={i} 
              onClick={() => {
                handleHabitSelect(habit.label);
              }}
              style={{
                padding: '8px',
                cursor: 'pointer',
                backgroundColor: '#f8f9fa',
                margin: '2px 0',
                borderRadius: '6px',
                color: 'black',
                fontWeight: '500',
                border: '1px solid #e9ecef',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#007AFF';
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.transform = 'translateX(2px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#f8f9fa';
                e.currentTarget.style.color = 'black';
                e.currentTarget.style.transform = 'translateX(0px)';
              }}
            >
              {habit.emoji} {habit.label}
            </div>
          ))}
        </div>
      )}
      
      {/* Ultra-native macOS-style widget */}
      <div 
        className="flex items-center justify-between px-4 py-2.5 w-full h-full relative"
        style={{ 
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(30px) saturate(200%)',
          WebkitBackdropFilter: 'blur(30px) saturate(200%)',
          borderRadius: '12px',
          border: '0.5px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
          WebkitAppearance: 'none',
          height: '50px',
        }}
      >
        {/* Drag region - more specific to avoid button conflicts */}
        <div className="tauri-drag-region absolute left-0 top-0 bottom-0 right-32 rounded-l-xl" data-tauri-drag-region />
              
              {/* Left side - Timer display and habit selector */}
              <div className="flex items-center gap-3 relative z-10">
                <div 
                  className="text-sm font-mono font-medium px-3 py-1.5 rounded-lg"
                  style={{
                    background: 'rgba(0, 0, 0, 0.06)',
                    color: 'rgba(0, 0, 0, 0.85)',
                    border: '0.5px solid rgba(0, 0, 0, 0.08)',
                    boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.05)',
                  }}
                >
                  {formatTime(time)}
                </div>
                
                {/* Working habit selector with proper positioning */}
                <div className="relative z-50">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowHabitSelector(prev => !prev);
                  }}
                  className="flex items-center gap-1 text-sm font-medium transition-all duration-150 px-2 py-1 rounded-md hover:bg-black/5"
                  style={{ 
                    color: 'rgba(0, 0, 0, 0.85)',
                    background: showHabitSelector ? 'rgba(0, 123, 255, 0.1)' : 'transparent'
                  }}
                  type="button"
                >
                  <span>{selectedHabit}</span>
                  <ChevronDown 
                    size={12} 
                    style={{ 
                      opacity: 0.5,
                      transform: showHabitSelector ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease'
                    }} 
                  />
                </button>
                

                </div>
              </div>
    
              {/* Right side - Controls */}
              <div className="flex items-center gap-1 relative z-20">
                {/* Play/Pause button */}
                <button
                  onClick={handlePlayPause}
                  className="p-2 rounded-lg transition-all duration-150 flex items-center justify-center"
                  style={{
                    background: 'rgba(0, 0, 0, 0.04)',
                    border: '0.5px solid rgba(0, 0, 0, 0.06)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)';
                  }}
                  title={isRunning ? 'Pause' : 'Start'}
                  type="button"
                >
                  {isRunning ? (
                    <Pause size={14} style={{ color: 'rgba(0, 0, 0, 0.7)' }} />
                  ) : (
                    <Play size={14} style={{ color: 'rgba(0, 0, 0, 0.7)' }} />
                  )}
                </button>
    
                {/* Complete button - only show when running */}
                {isRunning && (
                  <button
                    onClick={handleComplete}
                    className="p-2 rounded-lg transition-all duration-150 flex items-center justify-center"
                    style={{
                      background: 'rgba(52, 199, 89, 0.1)',
                      border: '0.5px solid rgba(52, 199, 89, 0.2)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(52, 199, 89, 0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(52, 199, 89, 0.1)';
                    }}
                    title="Complete session"
                    type="button"
                  >
                    <div 
                      className="w-3 h-3 rounded-sm" 
                      style={{ background: 'rgb(52, 199, 89)' }}
                    />
                  </button>
                )}
    
                {/* Close button */}
                <button
                  onClick={handleClose}
                  className="p-2 rounded-lg transition-all duration-150 flex items-center justify-center"
                  style={{
                    background: 'rgba(255, 59, 48, 0.08)',
                    border: '0.5px solid rgba(255, 59, 48, 0.15)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 59, 48, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 59, 48, 0.08)';
                  }}
                  title="Close widget"
                  type="button"
                >
                  <X size={14} style={{ color: 'rgba(255, 59, 48, 0.8)' }} />
                </button>
              </div>
      </div>
    </div>
  )
}