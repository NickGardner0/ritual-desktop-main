/**
 * ⚠️ DEPRECATED: This service is legacy code
 * 
 * DO NOT USE THIS FOR NEW FEATURES!
 * 
 * All habit management now uses:
 * - Frontend: HabitsContext (contexts/HabitsContext.tsx)
 * - Backend: Python FastAPI (backend/main.py)
 * - Database: SQLite + Tinybird
 * - Auth: Clerk
 * 
 * This file is kept only for:
 * - Type definitions (Habit, HabitLog interfaces)
 * - Backward compatibility during migration
 * 
 * Use `useHabits()` hook from HabitsContext instead!
 */

// Python backend API configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL;
if (!API_BASE_URL) {
  throw new Error('NEXT_PUBLIC_PYTHON_API_URL must be configured');
}

export interface Habit {
  id?: string
  name: string
  category: string
  icon?: string
  is_custom?: boolean
  integration_source?: string
  created_at?: string
  updated_at?: string
  user_id?: string
  unit_type?: string
}

export interface HabitLog {
  id?: string
  habit_id: string
  duration?: number
  amount?: number
  unit?: string  // Added unit property to match Tinybird schema
  date: string
  completed_at?: string
  status: 'completed' | 'skipped' | 'missed'
  notes?: string
}

// All actual functionality is now in HabitsContext
// Use: const { habits, logHabit, createHabit, ... } = useHabits()
