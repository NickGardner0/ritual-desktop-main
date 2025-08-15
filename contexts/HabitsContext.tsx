'use client';

import * as React from 'react';
import apiClient from '@/lib/api-client';

// Type for a habit
export interface Habit {
  value: string;
  label: string;
  emoji: string;
  stat: string;
}

// Mock user ID (replace with actual auth integration later)
const getMockUserId = () => 'user-123';

// Props for the context provider
export interface HabitsContextType {
  selectedHabits: string[];
  setSelectedHabits: (habits: string[]) => void;
  customHabits: Array<Habit>;
  addCustomHabit: (habit: Habit) => void;
  habitOrder: string[];
  setHabitOrder: (order: string[]) => void;
  fetchHabitsFromApi: () => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

// Create the context with default values
export const HabitsContext = React.createContext<HabitsContextType>({
  selectedHabits: [],
  setSelectedHabits: () => {},
  customHabits: [],
  addCustomHabit: () => {},
  habitOrder: [],
  setHabitOrder: () => {},
  fetchHabitsFromApi: async () => {},
  isLoading: false,
  error: null,
});

// Create a provider component for this context
export function HabitsProvider({ children }: { children: React.ReactNode }) {
  const [selectedHabits, setSelectedHabits] = React.useState<string[]>([]);
  const [customHabits, setCustomHabits] = React.useState<Array<Habit>>([]);
  const [habitOrder, setHabitOrder] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  // Load saved habits and habit order from localStorage on mount
  React.useEffect(() => {
    const savedSelectedHabits = typeof window !== 'undefined' ? localStorage.getItem('selectedHabits') : null;
    const savedHabitOrder = typeof window !== 'undefined' ? localStorage.getItem('habitOrder') : null;
    const savedCustomHabits = typeof window !== 'undefined' ? localStorage.getItem('customHabits') : null;

    if (savedSelectedHabits) {
      try {
        setSelectedHabits(JSON.parse(savedSelectedHabits));
      } catch (error) {
        console.error('Error parsing selectedHabits from localStorage:', error);
      }
    }

    if (savedHabitOrder) {
      try {
        setHabitOrder(JSON.parse(savedHabitOrder));
      } catch (error) {
        console.error('Error parsing habitOrder from localStorage:', error);
      }
    }

    if (savedCustomHabits) {
      try {
        setCustomHabits(JSON.parse(savedCustomHabits));
      } catch (error) {
        console.error('Error parsing customHabits from localStorage:', error);
      }
    }
    
    // Initial fetch of habits
    fetchHabitsFromApi();
  }, []);

  // Save to localStorage when state changes
  React.useEffect(() => {
          if (typeof window !== 'undefined') {
        localStorage.setItem('selectedHabits', JSON.stringify(selectedHabits));
      }
  }, [selectedHabits]);

  React.useEffect(() => {
          if (typeof window !== 'undefined') {
        localStorage.setItem('habitOrder', JSON.stringify(habitOrder));
      }
  }, [habitOrder]);

  React.useEffect(() => {
          if (typeof window !== 'undefined') {
        localStorage.setItem('customHabits', JSON.stringify(customHabits));
      }
  }, [customHabits]);

  // Function to add a custom habit
  const addCustomHabit = (habit: Habit) => {
    setCustomHabits(prev => [...prev, habit]);
    // Also automatically select the new custom habit
    setSelectedHabits(prev => [...prev, habit.value]);
    // Add the new habit to the end of the order
    setHabitOrder(prev => [...prev, habit.value]);
  };

  // Function to fetch habits from API
  const fetchHabitsFromApi = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Get the user ID (replace with auth when implemented)
      const userId = getMockUserId();
      
      // Fetch habits from the API
      const response = await apiClient.habits.getAll();
      
      // Process the habits data
      if (response && Array.isArray(response)) {
        // Map API habit format to our habit format
        const apiHabits: Habit[] = response.map(habit => ({
          value: habit.id,
          label: habit.name,
          emoji: habit.emoji || '🔄',
          stat: habit.streak > 0 ? `${habit.streak} day streak` : 'No streak yet'
        }));
        
        // Update custom habits with API data
        setCustomHabits(apiHabits);
        
        // If no habits are selected, select the first few
        if (selectedHabits.length === 0 && apiHabits.length > 0) {
          const initialHabits = apiHabits.slice(0, 3).map(h => h.value);
          setSelectedHabits(initialHabits);
          setHabitOrder(initialHabits);
        }
      }
      
      setIsLoading(false);
    } catch (err) {
      console.error("Failed to fetch habits:", err);
      setError(err instanceof Error ? err : new Error('Failed to fetch habits'));
      setIsLoading(false);
    }
  };

  return (
    <HabitsContext.Provider
      value={{
        selectedHabits,
        setSelectedHabits,
        customHabits,
        addCustomHabit,
        habitOrder,
        setHabitOrder,
        fetchHabitsFromApi,
        isLoading,
        error,
      }}
    >
      {children}
    </HabitsContext.Provider>
  );
}

// Custom hook for using the habits context
export function useHabits() {
  const context = React.useContext(HabitsContext);
  
  if (context === undefined) {
    throw new Error('useHabits must be used within a HabitsProvider');
  }
  
  return context;
} 