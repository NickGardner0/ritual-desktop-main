'use client';

import { useEffect } from 'react';

export default function SentryTestPage() {
  useEffect(() => {
    // This will throw an error and send it to Sentry
    const testSentry = () => {
      throw new Error('🧪 This is a test error to verify Sentry is working!');
    };
    
    // Uncomment this line to trigger the test error
    // testSentry();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Sentry Test Page</h1>
      <p className="mb-4">
        This page is for testing Sentry error tracking.
      </p>
      
      <button
        onClick={() => {
          throw new Error('🧪 Manual test error - Sentry should capture this!');
        }}
        className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
      >
        Click to Trigger Test Error
      </button>
      
      <div className="mt-4 p-4 bg-gray-100 rounded">
        <p className="text-sm text-gray-600">
          Click the button above to throw a test error. 
          Then check your Sentry dashboard to see if it appears.
        </p>
      </div>
    </div>
  );
}

