/**
 * OpenPanel Analytics Utilities
 * 
 * This module provides typed event tracking functions for common actions
 * in the Ritual app. Use these functions to track user behavior consistently.
 */

import { useOpenPanel } from '@openpanel/nextjs';

// ============================================================================
// Event Names - Keep these consistent across the app
// ============================================================================

export const ANALYTICS_EVENTS = {
  // Habit Events
  HABIT_CREATED: 'habit_created',
  HABIT_UPDATED: 'habit_updated',
  HABIT_DELETED: 'habit_deleted',
  HABIT_LOGGED: 'habit_logged',
  HABIT_LOG_DELETED: 'habit_log_deleted',
  
  // Timer Events
  TIMER_STARTED: 'timer_started',
  TIMER_PAUSED: 'timer_paused',
  TIMER_COMPLETED: 'timer_completed',
  TIMER_CANCELLED: 'timer_cancelled',
  
  // Integration Events
  INTEGRATION_CONNECTED: 'integration_connected',
  INTEGRATION_DISCONNECTED: 'integration_disconnected',
  INTEGRATION_SYNCED: 'integration_synced',
  
  // AI Chat Events
  AI_CHAT_MESSAGE_SENT: 'ai_chat_message_sent',
  AI_CHAT_HABIT_SUGGESTION_ACCEPTED: 'ai_chat_habit_suggestion_accepted',
  
  // Navigation Events
  PAGE_VIEW: 'page_view',
  QUICK_ACTIONS_OPENED: 'quick_actions_opened',
  
  // User Events
  ONBOARDING_COMPLETED: 'onboarding_completed',
  SETTINGS_UPDATED: 'settings_updated',
} as const;

export type AnalyticsEvent = typeof ANALYTICS_EVENTS[keyof typeof ANALYTICS_EVENTS];

// ============================================================================
// Typed Event Properties
// ============================================================================

export interface HabitEventProps {
  habitId: string;
  habitName: string;
  category?: string;
  source?: string;
}

export interface TimerEventProps {
  habitId: string;
  habitName: string;
  durationSeconds?: number;
}

export interface IntegrationEventProps {
  integrationName: string;
  integrationId?: string;
}

export interface AIChatEventProps {
  messageLength?: number;
  habitName?: string;
}

// ============================================================================
// Analytics Hook
// ============================================================================

/**
 * Custom hook for tracking analytics events with typed properties
 * 
 * @example
 * const { trackHabitCreated, trackTimerStarted } = useAnalytics();
 * 
 * // Track a habit creation
 * trackHabitCreated({ habitId: '123', habitName: 'Exercise', category: 'Fitness & Health' });
 */
export function useAnalytics() {
  const op = useOpenPanel();

  return {
    // Generic track function for custom events
    track: (event: string, properties?: Record<string, unknown>) => {
      op.track(event, properties);
    },

    // Habit Events
    trackHabitCreated: (props: HabitEventProps) => {
      op.track(ANALYTICS_EVENTS.HABIT_CREATED, { ...props });
    },
    trackHabitUpdated: (props: HabitEventProps) => {
      op.track(ANALYTICS_EVENTS.HABIT_UPDATED, { ...props });
    },
    trackHabitDeleted: (props: HabitEventProps) => {
      op.track(ANALYTICS_EVENTS.HABIT_DELETED, { ...props });
    },
    trackHabitLogged: (props: HabitEventProps & { value?: number; unit?: string; source?: string }) => {
      op.track(ANALYTICS_EVENTS.HABIT_LOGGED, { ...props });
    },
    trackHabitLogDeleted: (props: { logId: string; habitName: string }) => {
      op.track(ANALYTICS_EVENTS.HABIT_LOG_DELETED, { ...props });
    },

    // Timer Events
    trackTimerStarted: (props: TimerEventProps) => {
      op.track(ANALYTICS_EVENTS.TIMER_STARTED, { ...props });
    },
    trackTimerPaused: (props: TimerEventProps) => {
      op.track(ANALYTICS_EVENTS.TIMER_PAUSED, { ...props });
    },
    trackTimerCompleted: (props: TimerEventProps) => {
      op.track(ANALYTICS_EVENTS.TIMER_COMPLETED, { ...props });
    },
    trackTimerCancelled: (props: TimerEventProps) => {
      op.track(ANALYTICS_EVENTS.TIMER_CANCELLED, { ...props });
    },

    // Integration Events
    trackIntegrationConnected: (props: IntegrationEventProps) => {
      op.track(ANALYTICS_EVENTS.INTEGRATION_CONNECTED, { ...props });
    },
    trackIntegrationDisconnected: (props: IntegrationEventProps) => {
      op.track(ANALYTICS_EVENTS.INTEGRATION_DISCONNECTED, { ...props });
    },
    trackIntegrationSynced: (props: IntegrationEventProps & { recordsCount?: number }) => {
      op.track(ANALYTICS_EVENTS.INTEGRATION_SYNCED, { ...props });
    },

    // AI Chat Events
    trackAIChatMessageSent: (props: AIChatEventProps) => {
      op.track(ANALYTICS_EVENTS.AI_CHAT_MESSAGE_SENT, { ...props });
    },
    trackAIChatSuggestionAccepted: (props: AIChatEventProps) => {
      op.track(ANALYTICS_EVENTS.AI_CHAT_HABIT_SUGGESTION_ACCEPTED, { ...props });
    },

    // Navigation Events
    trackQuickActionsOpened: () => {
      op.track(ANALYTICS_EVENTS.QUICK_ACTIONS_OPENED);
    },

    // User Events
    trackOnboardingCompleted: (props: { habitsSelected: number }) => {
      op.track(ANALYTICS_EVENTS.ONBOARDING_COMPLETED, { ...props });
    },
    trackSettingsUpdated: (props: { setting: string; value?: string }) => {
      op.track(ANALYTICS_EVENTS.SETTINGS_UPDATED, { ...props });
    },

    // User profile updates
    setUserProperties: (properties: Record<string, unknown>) => {
      op.setGlobalProperties(properties);
    },
  };
}

// ============================================================================
// Server-side Analytics (for API routes)
// ============================================================================

export { OpenPanel } from '@openpanel/nextjs';

