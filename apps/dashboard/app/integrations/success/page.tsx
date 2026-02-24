'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

// Force dynamic rendering since this page uses useSearchParams
export const dynamic = 'force-dynamic';

/**
 * Success page content component (wrapped in Suspense)
 */
function IntegrationSuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const sessionId = searchParams.get('sessionId');
    const sessionToken = searchParams.get('sessionToken');

    console.log('📱 Success page loaded', {
      hasCode: !!code,
      hasError: !!error,
      sessionId,
      hasSessionToken: !!sessionToken,
    });

    // Handle error from OAuth
    if (error) {
      setStatus('error');
      setErrorMessage(error);
      return;
    }

    // Store code for desktop app to retrieve
    if (code && sessionId && sessionToken) {
      storeCode(code, sessionId, sessionToken);
    } else if (code && !sessionId) {
      // No session ID means something went wrong
      setStatus('error');
      setErrorMessage('Missing session ID. Please try connecting again from your desktop app.');
    } else if (code && !sessionToken) {
      setStatus('error');
      setErrorMessage('Missing session token. Please try connecting again from your desktop app.');
    } else {
      // No code means something went wrong
      setStatus('error');
      setErrorMessage('No authorization code received');
    }
  }, [searchParams]);

  /**
   * Store OAuth code temporarily for desktop app to retrieve
   */
  async function storeCode(code: string, sessionId: string, sessionToken: string) {
    try {
      console.log('💾 Storing OAuth code for session:', sessionId);

      const response = await fetch('/api/integrations/whoop/store-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code, sessionId, sessionToken })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to store code');
      }

      console.log('✅ Code stored successfully!');
      setStatus('success');

      // Try to close the window after a delay
      setTimeout(() => {
        console.log('Attempting to close window...');
        window.close();
      }, 3000);

    } catch (error) {
      console.error('❌ Error storing code:', error);
      setStatus('error');
      
      // Better error message extraction
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else if (typeof error === 'string') {
        setErrorMessage(error);
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
    }
  }

  if (status === 'processing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-lg shadow-xl p-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="rounded-full bg-blue-100 p-4">
                <BrailleSpinner className="text-5xl text-blue-600" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">
              Connecting...
            </h1>
            <p className="text-gray-600">
              Please wait while we complete the connection.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-red-100">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-lg shadow-xl p-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="rounded-full bg-red-100 p-4">
                <XCircle className="w-16 h-16 text-red-600" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">
              Connection Failed
            </h1>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-900 font-medium mb-2">
                Error Details:
              </p>
              <p className="text-sm text-red-700 break-words">
                {errorMessage || 'An error occurred while connecting.'}
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900 font-medium mb-2">
                📱 Return to your desktop app
              </p>
              <p className="text-sm text-blue-700">
                Please try again from your desktop app.
              </p>
            </div>
            <button
              onClick={() => window.close()}
              className="mt-4 px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              Close This Window
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-green-100">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center">
          {/* Success Icon */}
          <div className="flex justify-center mb-6">
            <div className="rounded-full bg-green-100 p-4">
              <CheckCircle2 className="w-16 h-16 text-green-600" />
            </div>
          </div>

          {/* Success Message */}
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Successfully Connected!
          </h1>
          
          <p className="text-gray-600 mb-6">
            Your Whoop integration has been connected successfully.
          </p>

          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-900 font-medium mb-2">
              📱 Return to your desktop app
            </p>
            <p className="text-sm text-blue-700">
              You can close this browser window and go back to your desktop app.
            </p>
          </div>

          {/* Auto-close message */}
          <p className="text-xs text-gray-500">
            This window will attempt to close automatically...
          </p>
          
          {/* Manual close button */}
          <button
            onClick={() => window.close()}
            className="mt-4 px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
          >
            Close This Window
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Main page component - wraps content in Suspense
 */
export default function IntegrationSuccessPage() {
  return (
    <Suspense 
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
          <div className="max-w-md w-full mx-4">
            <div className="bg-white rounded-lg shadow-xl p-8 text-center">
              <div className="flex justify-center mb-6">
                <div className="rounded-full bg-blue-100 p-4">
                  <BrailleSpinner className="text-5xl text-blue-600" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-3">
                Loading...
              </h1>
            </div>
          </div>
        </div>
      }
    >
      <IntegrationSuccessContent />
    </Suspense>
  );
}
