import { useMemo } from 'react';
import MiniSearch from 'minisearch';
import {
  productivityHabits,
  fitnessHealthHabits,
  educationHabits,
  experimentsHabits,
  type Habit,
} from '../../data/habits-data';
import { getHabitsForCategory } from './habit-catalog';

export function useHabitSelectionSearch(selectedCategory: string | null, searchQuery: string) {
  const miniSearch = useMemo(() => {
    try {
      const instance = new MiniSearch<Habit & { id: number }>({
        fields: ['label', 'category'],
        storeFields: ['value', 'label', 'category'],
        searchOptions: {
          boost: { label: 2 },
          fuzzy: 0.2,
          prefix: true
        }
      });

      // Index all habits
      const allHabitsForSearch = [
        ...(productivityHabits || []),
        ...(fitnessHealthHabits || []),
        ...(educationHabits || []),
        ...(experimentsHabits || [])
      ];

      const indexedHabits = allHabitsForSearch.map((habit, index) => ({
        id: index,
        ...habit
      }));

      if (indexedHabits.length > 0) {
        instance.addAll(indexedHabits);
      }
      
      return instance;
    } catch (error) {
      console.error('Error initializing MiniSearch:', error);
      // Return a minimal instance that won't crash
      return new MiniSearch<Habit & { id: number }>({
        fields: ['label', 'category'],
        storeFields: ['value', 'label', 'category']
      });
    }
  }, []); // Only initialize once
  
  // MiniSearch fuzzy search with fallback
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !selectedCategory) return [];
    
    try {
      const results = miniSearch.search(searchQuery, {
        filter: (result) => {
          const categoryMatch: { [key: string]: string } = {
            'productivity': 'productivity',
            'fitness': 'fitness',
            'education': 'education',
            'experiments': 'experiments'
          };
          return result.category === categoryMatch[selectedCategory];
        }
      });
      
      return results.map(result => ({
        value: result.value,
        label: result.label
      }));
    } catch (error) {
      console.error('Error searching with MiniSearch:', error);
      // Fallback to simple search if MiniSearch fails
      const categoryHabits = getHabitsForCategory(selectedCategory);
      const query = searchQuery.toLowerCase().trim();
      return categoryHabits.filter((habit: any) =>
        !habit.section && (
          habit.label.toLowerCase().includes(query) ||
          habit.value.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, selectedCategory, miniSearch]);
  
  // Get habits for display (search results or all category habits)
  const displayedHabits = useMemo(() => {
    if (searchQuery.trim() && searchResults.length > 0) {
      return searchResults;
    }
    if (searchQuery.trim() && searchResults.length === 0) {
      return []; // Show "no results"
    }
    return getHabitsForCategory(selectedCategory || '');
  }, [searchQuery, searchResults, selectedCategory]);

  return { searchResults, displayedHabits };
}
