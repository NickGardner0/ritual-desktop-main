import type { HabitCanvasData } from '@/components/chat/habit-canvas';

export type ChatActionReceiptData = {
  receipt_id: string;
  action_kind: string;
  habit_id?: string | null;
  habit_name?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  was_inserted?: boolean;
  undoable?: boolean;
  log_id?: string | null;
  amount?: number | null;
  date?: string | null;
};

export type ChatEntityRef = {
  type: string;
  id: string;
  title?: string;
};

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  canvasData?: HabitCanvasData;
  replyChips?: string[];
  actionReceipts?: ChatActionReceiptData[];
  entityRefs?: ChatEntityRef[];
  durability?: {
    state: 'unsent' | 'queued_local' | 'failed_retryable';
    turnId: string;
    userText: string;
  };
}
