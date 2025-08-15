'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHabits } from '@/hooks/useHabits'


interface Props {
  open: boolean
  onClose: () => void
}

export function TimeTrackerWidget({ open, onClose }: Props) {
  const { habits, logHabitCompletion } = useHabits()
  const [selectedHabit, setSelectedHabit] = useState<string>('')
  const [time, setTime] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const selectedHabitData = habits.find((h) => h.id === selectedHabit)
  const targetMinutes = 30
  const progressPercentage = Math.min((time / (targetMinutes * 60)) * 100, 100)

  useEffect(() => {
    if (isRunning && !isPaused) {
      intervalRef.current = setInterval(() => {
        setTime((prevTime) => prevTime + 1)
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
  }, [isRunning, isPaused])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const handleStart = () => {
    if (!selectedHabit) return
    setIsRunning(true)
    setIsPaused(false)
  }

  const handlePause = () => {
    setIsPaused(!isPaused)
  }

  const handleStop = async () => {
    setIsRunning(false)
    setIsPaused(false)
    if (selectedHabitData && time > 0) {
      try {
        console.log(`🕐 Saving timer session: ${formatTime(time)} for ${selectedHabitData.name}`)
        
        await logHabitCompletion({
          habit_id: selectedHabitData.id,
          date: new Date().toISOString().split('T')[0],
          duration: time,
          amount: 1,
          unit: 'session',
          status: 'completed',
          notes: `Timer session: ${formatTime(time)}`
        })
        
        console.log(`✅ Successfully saved ${formatTime(time)} session for ${selectedHabitData.name}`)
        
        setTime(0)
        
        // Notify dashboard to refresh data
        if (typeof window !== 'undefined') {
          localStorage.setItem('ritual-timer-updated', Date.now().toString())
          window.dispatchEvent(new StorageEvent('storage', {
            key: 'ritual-timer-updated',
            newValue: Date.now().toString()
          }))
        }
        
        alert(`✅ Session saved! ${formatTime(time)} of ${selectedHabitData.name} completed.`)
        
      } catch (err) {
        console.error('❌ Failed to log habit completion:', err)
        alert('❌ Failed to save session. Please try again.')
      }
    } else {
      setTime(0)
    }
  }

  const handleReset = () => {
    setTime(0)
    setIsRunning(false)
    setIsPaused(false)
  }

  const getStatusText = () => {
    if (!selectedHabit) return 'Choose a habit'
    if (isRunning && !isPaused) return 'Running'
    if (isPaused) return 'Paused'
    return 'Ready to start'
  }

  const getStatusColor = () => {
    if (!selectedHabit) return 'text-gray-500'
    if (isRunning && !isPaused) return 'text-green-600'
    if (isPaused) return 'text-yellow-600'
    return 'text-gray-700'
  }

  // Drag functionality
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const widgetRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setDragging(true)
    const rect = widgetRef.current?.getBoundingClientRect()
    if (rect) {
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
    e.preventDefault()
  }

  const handleDrag = (e: MouseEvent) => {
    if (!dragging) return
    const newX = Math.max(e.clientX - dragOffset.current.x, 120)
    const newY = Math.max(e.clientY - dragOffset.current.y, 0)
    setPosition({
      x: newX,
      y: newY,
    })
  }

  const handleDragEnd = () => setDragging(false)

  useEffect(() => {
    if (dragging) {
      if (typeof window !== 'undefined') {
        window.addEventListener('mousemove', handleDrag)
        window.addEventListener('mouseup', handleDragEnd)
      }
    } else {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', handleDrag)
        window.removeEventListener('mouseup', handleDragEnd)
      }
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', handleDrag)
        window.removeEventListener('mouseup', handleDragEnd)
      }
    }
  }, [dragging])

  // Set a default position if at (0,0)
  useEffect(() => {
    if (open && position.x === 0 && position.y === 0) {
      setPosition({ x: 120, y: 60 })
    }
  }, [open])

  return (
    <>
      {open && (
        <div 
          ref={widgetRef}
          className="fixed z-40 w-[400px] bg-white shadow-2xl flex flex-col overflow-hidden rounded-none border border-gray-200"
          style={{
            left: position.x,
            top: position.y,
            cursor: dragging ? 'grabbing' : 'default',
            zIndex: 1000,
            willChange: 'transform',
            pointerEvents: 'auto',
          }}
        >
          {/* Drag handle */}
          <div
            className="w-full h-8 cursor-grab z-20 flex items-center px-4 select-none group bg-gray-50 border-b border-gray-200"
            onMouseDown={handleDragStart}
          >
            <span className="text-sm font-medium text-gray-700">Time Tracker</span>
            <button 
              onClick={onClose} 
              className="ml-auto text-gray-400 hover:text-gray-700 text-sm"
            >
              ESC
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Habit Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Choose a habit</label>
              <Select value={selectedHabit} onValueChange={setSelectedHabit}>
                <SelectTrigger className="w-full rounded-none border border-gray-300 bg-white text-gray-900 focus:border-gray-400 focus:ring-0">
                  <SelectValue placeholder="Select a habit to track" />
                </SelectTrigger>
                <SelectContent className="z-[9999]" position="popper" side="bottom" align="start">
                  {habits.map((habit) => (
                    <SelectItem key={habit.id} value={habit.id}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{habit.icon || '📝'}</span>
                        <span>{habit.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Timer Display */}
            <div className="text-center space-y-2">
              <div className="text-3xl font-bold text-gray-900 tracking-wider font-mono">
                {formatTime(time)}
              </div>
              <div className={`text-sm ${getStatusColor()}`}>
                {getStatusText()}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gray-900 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>

            {/* Control Buttons */}
            <div className="flex gap-2">
              {!isRunning ? (
                <>
                  <Button
                    onClick={handleStart}
                    disabled={!selectedHabit}
                    className="flex-1 px-1.5 py-0.5 bg-white border border-gray-300 text-gray-900 font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 transition-colors rounded-none text-xs h-6"
                  >
                    <Play className="w-2 h-2 mr-1" />
                    Start
                  </Button>
                  <Button
                    disabled
                    className="flex-1 px-1.5 py-0.5 bg-gray-100 text-gray-400 font-medium cursor-not-allowed rounded-none text-xs h-6"
                  >
                    <Pause className="w-2 h-2 mr-1" />
                    Pause
                  </Button>
                  <Button
                    disabled
                    className="flex-1 px-1.5 py-0.5 bg-gray-100 text-gray-400 font-medium cursor-not-allowed rounded-none text-xs h-6"
                  >
                    <Square className="w-2 h-2 mr-1" />
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={isPaused}
                    className="flex-1 px-1.5 py-0.5 bg-gray-100 text-gray-400 font-medium cursor-not-allowed rounded-none text-xs h-6"
                  >
                    <Play className="w-2 h-2 mr-1" />
                    Start
                  </Button>
                  <Button
                    onClick={handlePause}
                    className="flex-1 px-1.5 py-0.5 bg-white border border-gray-300 text-gray-900 font-medium hover:bg-gray-50 transition-colors rounded-none text-xs h-6"
                  >
                    <Pause className="w-2 h-2 mr-1" />
                    Pause
                  </Button>
                  <Button
                    onClick={handleStop}
                    className="flex-1 px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white font-medium transition-colors rounded-none text-xs h-6"
                  >
                    <Square className="w-2 h-2 mr-1" />
                    Stop
                  </Button>
                </>
              )}
            </div>

            {/* Reset Button */}
            <Button
              onClick={handleReset}
              variant="outline"
              className="w-full px-1.5 py-0.5 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-none text-xs h-6"
            >
              Reset Timer
            </Button>
          </div>
        </div>
      )}
    </>
  )
} 