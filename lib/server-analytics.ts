/**
 * Server-side Analytics for API Routes
 * 
 * Use this module to track events from API routes and server actions.
 * Requires OPENPANEL_SECRET_KEY to be set in environment variables.
 */

import { OpenPanel } from '@openpanel/nextjs';

const OPENPANEL_CLIENT_ID = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID || '';
const OPENPANEL_SECRET_KEY = process.env.OPENPANEL_SECRET_KEY || '';

// Initialize the OpenPanel server SDK
const opServer = new OpenPanel({
  clientId: OPENPANEL_CLIENT_ID,
  clientSecret: OPENPANEL_SECRET_KEY,
});

/**
 * Track a server-side event
 * 
 * @example
 * await trackServerEvent('api_habit_created', { habitId: '123', userId: 'user_abc' });
 */
export async function trackServerEvent(
  event: string,
  properties?: Record<string, unknown>,
  profileId?: string
) {
  if (!OPENPANEL_CLIENT_ID || !OPENPANEL_SECRET_KEY) {
    console.warn('[OpenPanel Server] Missing credentials. Event not tracked:', event);
    return;
  }

  try {
    await opServer.track(event, {
      ...properties,
      ...(profileId ? { profileId } : {}),
    });
  } catch (error) {
    console.error('[OpenPanel Server] Failed to track event:', event, error);
  }
}

/**
 * Identify a user from server-side
 * 
 * @example
 * await identifyServerUser({
 *   profileId: 'user_123',
 *   email: 'user@example.com',
 *   firstName: 'John'
 * });
 */
export async function identifyServerUser(profile: {
  profileId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  avatar?: string;
  properties?: Record<string, unknown>;
}) {
  if (!OPENPANEL_CLIENT_ID || !OPENPANEL_SECRET_KEY) {
    console.warn('[OpenPanel Server] Missing credentials. User not identified.');
    return;
  }

  try {
    await opServer.identify(profile);
  } catch (error) {
    console.error('[OpenPanel Server] Failed to identify user:', error);
  }
}

// Export server event names for consistency
export const SERVER_EVENTS = {
  // API Events
  API_HABIT_CREATED: 'api_habit_created',
  API_HABIT_UPDATED: 'api_habit_updated', 
  API_HABIT_DELETED: 'api_habit_deleted',
  API_HABIT_LOGGED: 'api_habit_logged',
  
  // Sync Events
  WHOOP_SYNC_COMPLETED: 'whoop_sync_completed',
  WHOOP_SYNC_FAILED: 'whoop_sync_failed',
  
  // Auth Events
  USER_SIGNED_UP: 'user_signed_up',
  USER_SIGNED_IN: 'user_signed_in',
} as const;

