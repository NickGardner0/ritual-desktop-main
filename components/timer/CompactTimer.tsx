"use client"

import { useState, useEffect, useRef } from "react"
import { useHabits } from '@/hooks/useHabits'
import { Play, Pause, Square, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export default function CompactTimer({ onSessionComplete }: { onSessionComplete?: (sessionData: any) => void }) {
  const { habits, logHabitCompletion, loading: habitsLoading } = useHabits();
  const [selectedHabit, setSelectedHabit] = useState<string>("")
  const [time, setTime] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const selectedHabitData = habits.find((h) => h.id === selectedHabit)

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
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`
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
        console.log(`🕐 Saving timer session: ${formatTime(time)} for ${selectedHabitData.name}`);
        
        await logHabitCompletion({
          habit_id: selectedHabitData.id,
          date: new Date().toISOString().split('T')[0],
          duration: time,
          amount: 1,
          unit: 'session',
          status: 'completed',
          notes: `Timer session: ${formatTime(time)}`
        });
        
        console.log(`✅ Successfully saved ${formatTime(time)} session for ${selectedHabitData.name}`);
        
        // Reset timer after successful save
        setTime(0);
        
        // Notify parent component about completed session
        if (onSessionComplete) {
          onSessionComplete({
            habitName: selectedHabitData.name,
            duration: formatTime(time),
            durationSeconds: time,
            date: new Date().toISOString().split('T')[0]
          });
        }
        
        // Notify dashboard to refresh data
        if (typeof window !== 'undefined') {
          localStorage.setItem('ritual-timer-updated', Date.now().toString());
          window.dispatchEvent(new StorageEvent('storage', {
          key: 'ritual-timer-updated',
            newValue: Date.now().toString()
          }));
        }
        
      } catch (err) {
        console.error('❌ Failed to log habit completion:', err);
      }
    } else {
      setTime(0);
    }
  }

  const getStatusText = () => {
    if (!isRunning && time === 0) return "Ready to start"
    if (isPaused) return "Paused"
    if (isRunning) return "In progress"
    return "Session completed"
  }

  return (
    <div className="bg-white px-3 py-2 flex items-center gap-3 border border-gray-200">
      {/* Habit Selection */}
      <div className="flex items-center gap-2">
        <Select value={selectedHabit} onValueChange={setSelectedHabit} disabled={habitsLoading}>
          <SelectTrigger className="w-32 h-7 border border-gray-300 bg-white text-gray-900 focus:border-gray-400 focus:ring-0 rounded-none text-xs">
            <SelectValue placeholder={habitsLoading ? 'Loading...' : 'Choose habit'} />
          </SelectTrigger>
          <SelectContent className="rounded-none bg-white border-gray-300">
            {habits.map((habit) => (
              <SelectItem key={habit.id} value={habit.id} className="text-gray-900 hover:bg-gray-100">
                {habit.icon ? `${habit.icon} ` : ''}{habit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Timer Display */}
      <div className="flex items-center gap-2">
        <div className="text-sm font-bold text-gray-900 tracking-wider font-mono">{formatTime(time)}</div>
        <div className="text-xs text-gray-500">{getStatusText()}</div>
      </div>

      {/* Control Buttons */}
      <div className="flex gap-1">
        {!isRunning ? (
          <>
            <Button
              onClick={handleStart}
              disabled={!selectedHabit}
              className="px-1.5 py-0.5 bg-white border border-gray-300 text-gray-900 font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 transition-colors rounded-none text-xs h-6"
            >
              <Play className="w-2 h-2 mr-1" />
              Start
            </Button>
            <Button
              disabled
              className="px-1.5 py-0.5 bg-gray-100 text-gray-400 font-medium cursor-not-allowed rounded-none text-xs h-6"
            >
              <Pause className="w-2 h-2 mr-1" />
              Pause
            </Button>
            <Button
              disabled
              className="px-1.5 py-0.5 bg-gray-100 text-gray-400 font-medium cursor-not-allowed rounded-none text-xs h-6"
            >
              <Square className="w-2 h-2 mr-1" />
              Stop
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={isPaused}
              className="px-1.5 py-0.5 bg-gray-100 text-gray-400 font-medium cursor-not-allowed rounded-none text-xs h-6"
            >
              <Play className="w-2 h-2 mr-1" />
              Start
            </Button>
            <Button
              onClick={handlePause}
              className="px-1.5 py-0.5 bg-white border border-gray-300 text-gray-900 font-medium hover:bg-gray-50 transition-colors rounded-none text-xs h-6"
            >
              <Pause className="w-2 h-2 mr-1" />
              Pause
            </Button>
            <Button
              onClick={handleStop}
              className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white font-medium transition-colors rounded-none text-xs h-6"
            >
              <Square className="w-2 h-2 mr-1" />
              Stop
            </Button>
          </>
        )}
      </div>
    </div>
  )
} 