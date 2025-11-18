/**
 * Server Actions for Habit Management
 * 
 * Following Midday's pattern for mutations:
 * - Run on server (secure, fast)
 * - No API routes needed
 * - Auto-revalidation with revalidatePath
 * - Type-safe with TypeScript
 */

'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8000';

/**
 * Get auth token for server-side requests
 */
async function getServerToken(): Promise<string | null> {
  try {
    const { getToken } = await auth();
    return await getToken();
  } catch (error) {
    console.error('❌ Failed to get server token:', error);
    return null;
  }
}

/**
 * Ensure user is authenticated
 */
async function requireAuth(): Promise<string> {
  const { userId } = await auth();
  
  if (!userId) {
    redirect('/auth');
  }
  
  return userId;
}

// ================================
// HABIT CRUD ACTIONS
// ================================

export interface CreateHabitInput {
  name: string;
  description?: string;
  icon?: string;
  unit_type: 'duration' | 'amount' | 'completion';
  target_value?: number;
  target_unit?: string;
  frequency: 'daily' | 'weekly' | 'custom';
}

/**
 * Create a new habit
 */
export async function createHabit(input: CreateHabitInput) {
  const userId = await requireAuth();
  const token = await getServerToken();
  
  console.log('🔄 [Server Action] Creating habit:', input);
  
  try {
    const response = await fetch(`${PYTHON_API_URL}/api/habits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: JSON.stringify({
        ...input,
        user_id: userId,
        is_active: true,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create habit: ${error}`);
    }
    
    const habit = await response.json();
    console.log('✅ [Server Action] Habit created:', habit.id);
    
    // ✅ Auto-revalidate dashboard to show new habit
    revalidatePath('/dashboard');
    
    return { success: true, data: habit };
  } catch (error) {
    console.error('❌ [Server Action] Failed to create habit:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Update an existing habit
 */
export async function updateHabit(habitId: string, updates: Partial<CreateHabitInput>) {
  await requireAuth();
  const token = await getServerToken();
  
  console.log('🔄 [Server Action] Updating habit:', habitId);
  
  try {
    const response = await fetch(`${PYTHON_API_URL}/api/habits/${habitId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: JSON.stringify(updates),
    });
    
    if (!response.ok) {
      throw new Error('Failed to update habit');
    }
    
    const habit = await response.json();
    console.log('✅ [Server Action] Habit updated:', habitId);
    
    // ✅ Revalidate affected pages
    revalidatePath('/dashboard');
    revalidatePath('/analytics');
    
    return { success: true, data: habit };
  } catch (error) {
    console.error('❌ [Server Action] Failed to update habit:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a habit
 */
export async function deleteHabit(habitId: string) {
  await requireAuth();
  const token = await getServerToken();
  
  console.log('🔄 [Server Action] Deleting habit:', habitId);
  
  try {
    const response = await fetch(`${PYTHON_API_URL}/api/habits/${habitId}`, {
      method: 'DELETE',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete habit');
    }
    
    console.log('✅ [Server Action] Habit deleted:', habitId);
    
    // ✅ Revalidate affected pages
    revalidatePath('/dashboard');
    revalidatePath('/analytics');
    
    return { success: true };
  } catch (error) {
    console.error('❌ [Server Action] Failed to delete habit:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Reorder habits (update display_order)
 */
export async function reorderHabits(habitIds: string[]) {
  await requireAuth();
  const token = await getServerToken();
  
  console.log('🔄 [Server Action] Reordering habits:', habitIds);
  
  try {
    // Update display_order for each habit
    const updates = habitIds.map((habitId, index) => 
      fetch(`${PYTHON_API_URL}/api/habits/${habitId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        body: JSON.stringify({ display_order: index }),
      })
    );
    
    await Promise.all(updates);
    
    console.log('✅ [Server Action] Habits reordered');
    
    // ✅ Revalidate dashboard
    revalidatePath('/dashboard');
    
    return { success: true };
  } catch (error) {
    console.error('❌ [Server Action] Failed to reorder habits:', error);
    return { success: false, error: String(error) };
  }
}

// ================================
// HABIT LOG ACTIONS
// ================================

export interface LogHabitInput {
  habit_id: string;
  duration?: number;
  amount?: number;
  date: string;
  completed_at: string;
  status: 'completed' | 'skipped' | 'pending';
  notes?: string;
}

/**
 * Log a habit completion
 */
export async function logHabit(input: LogHabitInput) {
  const userId = await requireAuth();
  const token = await getServerToken();
  
  console.log('🔄 [Server Action] Logging habit:', input);
  
  try {
    const response = await fetch(`${PYTHON_API_URL}/api/habits/${input.habit_id}/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: JSON.stringify({
        ...input,
        user_id: userId,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to log habit');
    }
    
    const log = await response.json();
    console.log('✅ [Server Action] Habit logged:', log.id);
    
    // ✅ Revalidate affected pages
    revalidatePath('/dashboard');
    revalidatePath('/analytics');
    revalidatePath('/calendar');
    
    return { success: true, data: log };
  } catch (error) {
    console.error('❌ [Server Action] Failed to log habit:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Update a habit log
 */
export async function updateHabitLog(logId: string, habitId: string, updates: Partial<LogHabitInput>) {
  await requireAuth();
  const token = await getServerToken();
  
  console.log('🔄 [Server Action] Updating habit log:', logId);
  
  try {
    const response = await fetch(`${PYTHON_API_URL}/api/habits/${habitId}/logs/${logId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: JSON.stringify(updates),
    });
    
    if (!response.ok) {
      throw new Error('Failed to update log');
    }
    
    const log = await response.json();
    console.log('✅ [Server Action] Log updated:', logId);
    
    // ✅ Revalidate affected pages
    revalidatePath('/dashboard');
    revalidatePath('/analytics');
    
    return { success: true, data: log };
  } catch (error) {
    console.error('❌ [Server Action] Failed to update log:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a habit log
 */
export async function deleteHabitLog(logId: string, habitId: string) {
  await requireAuth();
  const token = await getServerToken();
  
  console.log('🔄 [Server Action] Deleting habit log:', logId);
  
  try {
    const response = await fetch(`${PYTHON_API_URL}/api/habits/${habitId}/logs/${logId}`, {
      method: 'DELETE',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete log');
    }
    
    console.log('✅ [Server Action] Log deleted:', logId);
    
    // ✅ Revalidate affected pages
    revalidatePath('/dashboard');
    revalidatePath('/analytics');
    
    return { success: true };
  } catch (error) {
    console.error('❌ [Server Action] Failed to delete log:', error);
    return { success: false, error: String(error) };
  }
}

