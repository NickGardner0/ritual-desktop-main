import type { ChatSuggestion } from '@/lib/ai/chat-suggestions';

export type InputMode = 'log' | 'chat';

export interface AIHabitChatProps {
  onHabitUpdate?: (habitData: any) => void;
  onImportData: () => void;
}

export interface ScreenshotPreview {
  habit_id: string | null;
  habit_name: string;
  value: number;
  unit: string;
  description: string;
  detected_type: string;
  confidence: number;
  low_confidence: boolean;
  validation: {
    is_valid: boolean;
    reason?: string;
    suggested_value?: number;
  };
  is_new_habit: boolean;
  available_habits: Array<{ id: string; name: string; unit_type: string }>;
}

export interface LogResult {
  index: number;
  success: boolean;
  habit_id?: string;
  habit_name?: string;
  value?: number;
  unit?: string;
  date?: string;
  error?: string;
}

export interface Clarification {
  index: number;
  habit_hint: string;
  value: number | null;
  unit: string | null;
  date: string;
  alternatives: Array<{ id: string; name: string; confidence: number }>;
  reason: string;
}

export interface LoggingResult {
  success: boolean;
  message: string;
  logged: LogResult[];
  clarifications: Clarification[];
  refreshNeeded?: boolean;
  affectedHabitIds?: string[];
}

export interface ParsedHabitInput {
  habitName: string;
  amount: number | null;
  duration: number | null;
  unit: string;
  activity: string;
  success: true;
}

export interface HabitOption {
  id: string;
  name: string;
  unit_type: string;
}

export type InlineSuggestionOption =
  | {
      kind: 'suggestion';
      key: string;
      label: string;
      sublabel?: string;
      suggestion: ChatSuggestion;
    }
  | {
      kind: 'clarification';
      key: string;
      label: string;
      sublabel?: string;
      clarificationIndex: number;
      habitId: string;
      habitName: string;
    };
