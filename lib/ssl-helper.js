// This file sets up global Node.js environment settings to handle SSL certificate issues
// Only use this in development environments

if (process.env.NODE_ENV !== 'production') {
  // Disable SSL certificate verification for development
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  
  console.warn(
    'SSL certificate verification is disabled for development. Do not use this setting in production.'
  );
}

export default function setupSsl() {
  // Function exists to allow importing this file
  return true;
} 