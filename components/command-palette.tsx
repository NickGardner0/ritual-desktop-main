'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Plus, X, ArrowLeft, ChevronDown, HelpCircle, ChevronRight, GripVertical, Search, ArrowUp, ArrowDown, ListTodo, FileText, Settings, Clock, Target, BarChart2, Moon, Command as CommandIcon, Keyboard, Calendar, Smartphone, FlaskConical, GraduationCap, CheckSquare, HeartPulse, Star } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useRouter } from 'next/navigation';

import { cn } from "@/lib/utils";
import apiClient from '@/lib/api-client';
import { useHabits } from '@/contexts/HabitsContext';
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Types for command palette data
interface CommandPaletteItem {
  id: string;
  name: string;
  type: string;
  emoji?: string;
  icon?: string;
  description?: string;
  shortcut?: string;
  category?: string;
  metadata?: Record<string, any>;
  usage_count: number;
  is_favorite: boolean;
}

interface CommandPaletteData {
  quick_actions: CommandPaletteItem[];
  habits: Record<string, CommandPaletteItem[]>;
  recent: CommandPaletteItem[];
  favorites: CommandPaletteItem[];
}

// Define the structure for our new category display
interface DisplayCategory {
  id: string; // Could map to HabitCategory enum or be a unique string
  name: string;
  icon: React.ReactNode;
  type: 'category_select'; // Differentiate from other CommandPaletteItem types
}

const displayCategories: DisplayCategory[] = [
  { id: 'productivity', name: 'Productivity', icon: <CheckSquare className="h-5 w-5" />, type: 'category_select' },
  { id: 'education', name: 'Education', icon: <GraduationCap className="h-5 w-5" />, type: 'category_select' },
  { id: 'fitness_health', name: 'Fitness & Health', icon: <HeartPulse className="h-5 w-5" />, type: 'category_select' },
  { id: 'experiments', name: 'Experiments', icon: <FlaskConical className="h-5 w-5" />, type: 'category_select' },
];

// Mock user ID (replace with actual auth integration)
const MOCK_USER_ID = 'user-123';

interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommandPalette({ open: externalOpen, onOpenChange }: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandData, setCommandData] = useState<CommandPaletteData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const { fetchHabitsFromApi } = useHabits();

  // Determine if the dialog is open based on internal or external state
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (onOpenChange) {
      onOpenChange(value);
    } else {
      setInternalOpen(value);
    }
  };

  // Fetch command palette data when dialog opens
  useEffect(() => {
    if (open) {
      fetchCommandPaletteData();
    }
  }, [open]);

  const fetchCommandPaletteData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.commandPalette.getData(MOCK_USER_ID) as CommandPaletteData;
      setCommandData(data);
    } catch (err) {
      console.error('Failed to fetch command palette data:', err);
      setError('Failed to load command palette data');
    } finally {
      setLoading(false);
    }
  };

  const handleItemSelect = async (item: CommandPaletteItem | DisplayCategory) => {
    try {
      // Handle different types of items
      if (item.type === 'category_select') {
        // TODO: Define what happens when a category is selected
        // For now, just log it and close the palette
        console.log('Selected category:', item.name);
        setOpen(false);
        return;
      }

      // Existing handleItemSelect logic for CommandPaletteItem
      if (item.type === 'habit') {
        // Complete habit
        await apiClient.habits.complete(item.id, {
          completed_at: new Date().toISOString(),
          count: 1
        });
        
        // Refresh habits data
        fetchHabitsFromApi();
      } else {
        // Record action usage
        await apiClient.commandPalette.recordActionUsage(MOCK_USER_ID, item.id);
        
        // Handle specific action types
        if (item.id === 'add_custom_habit') {
          // Navigate to add habit page or open add habit dialog
          console.log('Add custom habit');
        } else if (item.id === 'time_block') {
          // Navigate to time block page
          console.log('Time block');
        } else if (item.id === 'start_focus_session') {
          // Start focus session
          console.log('Start focus session');
        }
      }
      
      // Close the command palette
      setOpen(false);
    } catch (err) {
      console.error('Failed to handle command palette action:', err);
      setError('Failed to execute command');
    }
  };

  const handleToggleFavorite = async (item: CommandPaletteItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent item selection
    try {
      await apiClient.commandPalette.toggleFavorite(MOCK_USER_ID, item.id);
      // Refresh command palette data
      fetchCommandPaletteData();
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  const handleAddStarterHabits = async () => {
    try {
      await apiClient.habits.getStarterHabits(MOCK_USER_ID);
      // Refresh habits data
      fetchHabitsFromApi();
      // Refresh command palette data
      fetchCommandPaletteData();
    } catch (err) {
      console.error('Failed to add starter habits:', err);
      setError('Failed to add starter habits');
    }
  };

  const filterItems = (items: CommandPaletteItem[]) => {
    if (!searchQuery) return items;
    
    return items.filter(item => 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.emoji && item.emoji.includes(searchQuery))
    );
  };

  // Transform all items into a flat array for search results
  const getAllItems = (): (CommandPaletteItem | DisplayCategory)[] => {
    if (!commandData && searchQuery) return [...displayCategories]; // Allow searching categories even if other data not loaded
    if (!commandData) return [];
    
    const allItems: (CommandPaletteItem | DisplayCategory)[] = [
      ...displayCategories, // Add new display categories to all items for searching
      ...commandData.quick_actions
    ];
    
    // Add all habits
    Object.values(commandData.habits).forEach(habitGroup => {
      allItems.push(...habitGroup);
    });
    
    return allItems;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 gap-0 max-w-lg">
          <Command className="rounded-lg border shadow-md">
            <CommandInput 
              placeholder="Type a command or search..." 
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              {loading && (
                <div className="p-4 text-center">
                  <div className="animate-spin h-5 w-5 border-2 border-gray-300 rounded-full border-t-gray-600 mx-auto"></div>
                  <p className="mt-2 text-sm text-gray-500">Loading...</p>
                </div>
              )}
              
              {error && (
                <div className="p-4 text-center text-red-500">
                  <p>{error}</p>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="mt-2"
                    onClick={fetchCommandPaletteData}
                  >
                    Retry
                  </Button>
                </div>
              )}
              
              {!loading && !error && commandData && !searchQuery && (
                <>
                  {/* Render a new section for our displayCategories */}
                  <CommandGroup heading="Add by Category">
                    {displayCategories.map(category => (
                      <CommandItem
                        key={`cat-${category.id}`}
                        onSelect={() => handleItemSelect(category)}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex-shrink-0 w-6 text-center text-gray-500">{category.icon}</div>
                          <span>{category.name}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />

                  {/* Keep existing sections like Favorites, Recent, Quick Actions if needed */}
                  {/* Or remove/comment them out if the new category view replaces them entirely when not searching */}
                  
                  {commandData.favorites && commandData.favorites.length > 0 && (
                    <CommandGroup heading="Favorites">
                      {filterItems(commandData.favorites).map(item => (
                        <CommandItem
                          key={`${item.type}-${item.id}`}
                          onSelect={() => handleItemSelect(item)}
                          className="flex items-center justify-between px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            {item.emoji && (
                              <div className="flex-shrink-0 w-6 text-center">{item.emoji}</div>
                            )}
                            {item.icon && !item.emoji && (
                              <div className="flex-shrink-0 w-6 text-center"><span className="text-gray-400">{item.icon}</span></div>
                            )}
                            <span>{item.name}</span>
                          </div>
                          <div className="flex items-center">
                            {item.shortcut && (
                              <kbd className="bg-gray-100 px-1.5 py-0.5 text-xs rounded">{item.shortcut}</kbd>
                            )}
                            <button
                              onClick={(e) => handleToggleFavorite(item, e)}
                              className={cn(
                                "ml-2 text-gray-400 hover:text-yellow-500",
                                item.is_favorite && "text-yellow-500"
                              )}
                              title={item.is_favorite ? "Remove from favorites" : "Add to favorites"}
                            >
                              <svg 
                                width="14" 
                                height="14" 
                                viewBox="0 0 24 24" 
                                fill={item.is_favorite ? "currentColor" : "none"} 
                                stroke="currentColor" 
                                strokeWidth="2"
                              >
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                            </button>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* Hiding the detailed habit list for now, as requested */}
                  {/*
                  {Object.entries(commandData.habits).map(([category, habits]) => (
                    habits.length > 0 && (
                      <CommandGroup key={category} heading={category.toUpperCase()}>
                        {filterItems(habits).map(item => (
                          <CommandItem
                            key={`${item.type}-${item.id}`}
                            onSelect={() => handleItemSelect(item)}
                            className="flex items-center justify-between px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              {item.emoji && (
                                <div className="flex-shrink-0 w-6 text-center">{item.emoji}</div>
                              )}
                              <span>{item.name}</span>
                            </div>
                            <button
                              onClick={(e) => handleToggleFavorite(item, e)}
                              className={cn(
                                "ml-2 text-gray-400 hover:text-yellow-500",
                                item.is_favorite && "text-yellow-500"
                              )}
                              title={item.is_favorite ? "Remove from favorites" : "Add to favorites"}
                            >
                              <svg 
                                width="14" 
                                height="14" 
                                viewBox="0 0 24 24" 
                                fill={item.is_favorite ? "currentColor" : "none"} 
                                stroke="currentColor" 
                                strokeWidth="2"
                              >
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                            </button>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )
                  ))}
                  */}
                  
                  {/* Render Quick Actions - this can be kept or modified */}
                  {commandData.quick_actions && commandData.quick_actions.length > 0 && (
                    <CommandGroup heading="Quick Actions">
                      {filterItems(commandData.quick_actions).map(item => (
                        <CommandItem
                          key={`${item.type}-${item.id}`}
                          onSelect={() => handleItemSelect(item)}
                          className="flex items-center justify-between px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            {item.emoji && (
                              <div className="flex-shrink-0 w-6 text-center">{item.emoji}</div>
                            )}
                            {item.icon && !item.emoji && (
                              <div className="flex-shrink-0 w-6 text-center"><span className="text-gray-400">{item.icon}</span></div>
                            )}
                            <span>{item.name}</span>
                          </div>
                          {item.shortcut && (
                            <kbd className="bg-gray-100 px-1.5 py-0.5 text-xs rounded">{item.shortcut}</kbd>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* TODO: Consider if 'Add custom habit' needs special placement or is part of Quick Actions */}
                  {/* The current setup for 'Add custom habit' might be in quick_actions if its id is 'add_custom_habit' */}

                </>
              )}
            </CommandList>
            <div className="flex items-center justify-between p-1.5 border-t text-xs text-gray-500 bg-[#FAFAF9]">
              <div className="flex items-center gap-1">
                <ArrowUp className="h-3 w-3" />
                <ArrowDown className="h-3 w-3" />
                <span>Navigate</span>
              </div>
              
              <div className="flex items-center gap-2">
                <span>Enter to select</span>
              </div>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CommandPalette; 