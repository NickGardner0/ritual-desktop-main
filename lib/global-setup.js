// This file configures global settings for the Node.js environment
// It's designed to be imported at application startup

// Disable SSL certificate verification in development
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('SSL certificate verification disabled for development.');
}

// Export a dummy function to facilitate importing
export function setupGlobals() {
  return true;
} 