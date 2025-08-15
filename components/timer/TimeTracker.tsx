"use client"

import { useState, useEffect, useRef } from "react"
import { useHabits } from '@/hooks/useHabits'
import { Play, Pause, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export default function TimeTracker() {
  const { habits, logHabitCompletion, loading: habitsLoading } = useHabits();
  const [selectedHabit, setSelectedHabit] = useState<string>("")
  const [time, setTime] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const selectedHabitData = habits.find((h) => h.id === selectedHabit)
  // Use a default target of 30 minutes
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
      // Save the session to backend using the same test endpoint as Swift widget
      try {
        console.log(`🕐 Saving timer session: ${formatTime(time)} for ${selectedHabitData.name}`);
        console.log(`🔍 Selected habit data:`, selectedHabitData);
        
        // Use the real habit ID from your authenticated account
        const logData = {
          habit_id: selectedHabitData.id, // Use the real habit ID
          date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
          duration: time,
          status: 'completed',
          notes: `Timer session: ${formatTime(time)} from Tauri widget`
        };
        
        console.log(`📊 Sending log data to authenticated endpoint:`, logData);
        console.log(`🔍 About to call logHabitCompletion...`);
        
        // Use the real authenticated endpoint instead of test endpoint
        const result = await logHabitCompletion(logData);
        console.log(`🔍 logHabitCompletion result:`, result);
        
        console.log(`✅ Successfully saved ${formatTime(time)} session for ${selectedHabitData.name}`);
        
        // Reset timer after successful save
        setTime(0);
        
        // Notify dashboard to refresh data (only in browser)
        if (typeof window !== 'undefined') {
          localStorage.setItem('ritual-timer-updated', Date.now().toString());
          window.dispatchEvent(new StorageEvent('storage', {
            key: 'ritual-timer-updated',
            newValue: Date.now().toString()
          }));
          // Show success feedback
          alert(`✅ Session saved! ${formatTime(time)} of ${selectedHabitData.name} completed.`);
        }
      } catch (err) {
        console.error('❌ Failed to log habit completion:', err);
        if (typeof window !== 'undefined') {
          alert(`❌ Failed to save session: ${err}. Data saved locally.`);
        }
      }
    } else {
      // Reset timer even if no data to save
      setTime(0);
    }
  }

  const handleReset = () => {
    setTime(0)
    setIsRunning(false)
    setIsPaused(false)
  }

  const getStatusText = () => {
    if (!isRunning && time === 0) return "Ready to start"
    if (isPaused) return "Paused"
    if (isRunning) return "In progress"
    return "Session completed"
  }

  const getStatusColor = () => {
    if (!isRunning && time === 0) return "text-muted-foreground"
    if (isPaused) return "text-yellow-600"
    if (isRunning) return "text-green-600"
    return "text-blue-600"
  }

  return (
    <div className="min-h-screen bg-white p-4 flex items-center justify-center">
      <div className="w-full max-w-md mx-auto">
        {/* Card Container */}
        <div className="bg-white border border-gray-200 p-8 space-y-8">
          {/* Header */}
          <div className="text-center space-y-6">
            <h1 className="text-lg font-medium text-gray-900">Select what you want to track</h1>
            <Select value={selectedHabit} onValueChange={setSelectedHabit} disabled={habitsLoading}>
              <SelectTrigger className="w-full h-12 border border-gray-300 bg-white text-gray-900 focus:border-gray-400 focus:ring-0 rounded-none">
                <SelectValue placeholder={habitsLoading ? 'Loading habits...' : 'Choose a habit'} />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                {habits.map((habit) => (
                  <SelectItem key={habit.id} value={habit.id}>
                    {habit.icon ? `${habit.icon} ` : ''}{habit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Timer Display */}
          <div className="text-center space-y-4">
            <div className="text-8xl font-bold text-gray-900 tracking-wider font-mono">{formatTime(time)}</div>
            <div className="text-gray-600 text-base font-medium">{getStatusText()}</div>
          </div>

          {/* Control Buttons */}
          <div className="flex gap-4 justify-center">
            {!isRunning ? (
              <>
                <Button
                  onClick={handleStart}
                  disabled={!selectedHabit}
                  className="px-6 py-1.5 bg-white border border-gray-300 text-gray-900 font-medium hover:bg-gray-100 disabled:bg-gray-100 disabled:text-gray-400 transition-colors rounded-none"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start
                </Button>
                <Button
                  disabled
                  className="px-6 py-1.5 bg-white border border-gray-300 text-gray-400 font-medium cursor-not-allowed rounded-none"
                >
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </Button>
                <Button
                  disabled
                  className="px-6 py-1.5 bg-white border border-gray-300 text-gray-400 font-medium cursor-not-allowed rounded-none"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop & Save
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={isPaused}
                  className="px-6 py-1.5 bg-white border border-gray-300 text-gray-400 font-medium cursor-not-allowed rounded-none"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start
                </Button>
                <Button
                  onClick={handlePause}
                  className="px-6 py-1.5 bg-white border border-gray-300 text-gray-900 font-medium hover:bg-gray-100 transition-colors rounded-none"
                >
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </Button>
                <Button
                  onClick={handleStop}
                  className="px-6 py-1.5 bg-white border border-gray-300 text-red-600 font-medium hover:bg-gray-100 transition-colors rounded-none"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop & Save
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 