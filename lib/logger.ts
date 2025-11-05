/**
 * Logger Utility
 * 
 * Replaces console.log with environment-aware logging
 * - Development: Logs everything
 * - Production: Only logs errors and warnings
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('User logged in');
 *   logger.error('Failed to fetch data', error);
 */

const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  /**
   * Info logs - only in development
   */
  info: (...args: any[]) => {
    if (isDev) {
      console.log(...args);
    }
  },

  /**
   * Error logs - always logged (even in production)
   */
  error: (...args: any[]) => {
    console.error(...args);
    // TODO: Send to error tracking service (Sentry, etc.) in production
    // if (!isDev) {
    //   Sentry.captureException(args[0]);
    // }
  },

  /**
   * Warning logs - only in development
   */
  warn: (...args: any[]) => {
    if (isDev) {
      console.warn(...args);
    }
  },

  /**
   * Debug logs - only in development
   */
  debug: (...args: any[]) => {
    if (isDev) {
      console.debug(...args);
    }
  },

  /**
   * Success logs - only in development
   */
  success: (...args: any[]) => {
    if (isDev) {
      console.log('✅', ...args);
    }
  },
};

