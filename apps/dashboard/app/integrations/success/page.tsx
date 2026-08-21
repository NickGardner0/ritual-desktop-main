'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

// Force dynamic rendering since this page uses useSearchParams
export const dynamic = 'force-dynamic';
const devLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

/**
 * Success page content component (wrapped in Suspense)
 */
function IntegrationSuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const providerLabel = searchParams.get('provider') === 'tesla' ? 'Tesla' : 'Whoop';

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const sessionId = searchParams.get('sessionId');
    const sessionToken = searchParams.get('sessionToken');

    devLog('📱 Success page loaded', {
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
      devLog('💾 Storing OAuth code for session:', sessionId);

      const response = await fetch('/api/integrations/oauth/store-code', {
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

      devLog('✅ Code stored successfully!');
      setStatus('success');

      // Try to close the window after a delay
      setTimeout(() => {
        devLog('Attempting to close window...');
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
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.05),_transparent_45%),linear-gradient(180deg,_#f6f6f3_0%,_#efefe9_100%)] flex items-center justify-center px-6">
        <div className="max-w-md w-full mx-4">
          <div className="rounded-2xl border border-black/10 bg-white/90 p-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <div className="flex justify-center mb-6">
              <div className="rounded-full border border-black/10 bg-black/[0.04] p-4">
                <BrailleSpinner className="text-5xl text-black/65" />
              </div>
            </div>
            <h1 className="mb-3 text-2xl font-semibold tracking-[-0.03em] text-black/90">
              Finishing connection
            </h1>
            <p className="text-sm leading-6 text-black/55">
              Please wait while we complete the connection.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.05),_transparent_45%),linear-gradient(180deg,_#f6f6f3_0%,_#efefe9_100%)] flex items-center justify-center px-6">
        <div className="max-w-md w-full mx-4">
          <div className="rounded-2xl border border-black/10 bg-white/90 p-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <div className="flex justify-center mb-6">
              <div className="rounded-full border border-black/10 bg-black/[0.04] p-4">
                <XCircle className="h-16 w-16 text-black/70" />
              </div>
            </div>
            <h1 className="mb-3 text-2xl font-semibold tracking-[-0.03em] text-black/90">
              Connection Failed
            </h1>
            <div className="mb-6 rounded-xl border border-black/10 bg-black/[0.03] p-4 text-left">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-black/45">
                Error Details:
              </p>
              <p className="break-words text-sm leading-6 text-black/70">
                {errorMessage || 'An error occurred while connecting.'}
              </p>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.03] p-4">
              <p className="mb-2 text-sm font-medium text-black/80">
                Return to your desktop app
              </p>
              <p className="text-sm leading-6 text-black/55">
                Please try again from your desktop app.
              </p>
            </div>
            <button
              onClick={() => window.close()}
              className="mt-6 inline-flex h-11 items-center justify-center rounded-sm bg-black px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Close This Window
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.05),_transparent_45%),linear-gradient(180deg,_#f6f6f3_0%,_#efefe9_100%)] flex items-center justify-center px-6">
      <div className="max-w-md w-full mx-4">
        <div className="rounded-2xl border border-black/10 bg-white/90 p-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.08)] backdrop-blur-sm">
          <div className="flex justify-center mb-6">
            <div className="rounded-full border border-black/10 bg-black/[0.04] p-4">
              <CheckCircle2 className="h-16 w-16 text-black/75" />
            </div>
          </div>

          <h1 className="mb-3 text-2xl font-semibold tracking-[-0.03em] text-black/90">
            Connection complete
          </h1>
          
          <p className="mb-8 text-sm leading-6 text-black/55">
            Your {providerLabel} integration has been connected successfully.
          </p>

          <div className="mb-6 rounded-xl border border-black/10 bg-black/[0.03] p-5 text-left">
            <p className="mb-2 text-sm font-medium text-black/80">
              Return to your desktop app
            </p>
            <p className="text-sm leading-6 text-black/55">
              You can close this browser window and go back to your desktop app.
            </p>
          </div>

          <p className="text-xs uppercase tracking-[0.14em] text-black/35">
            This window will attempt to close automatically...
          </p>
          
          <button
            onClick={() => window.close()}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-sm bg-black px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
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
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.05),_transparent_45%),linear-gradient(180deg,_#f6f6f3_0%,_#efefe9_100%)] flex items-center justify-center px-6">
          <div className="max-w-md w-full mx-4">
            <div className="rounded-2xl border border-black/10 bg-white/90 p-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.08)] backdrop-blur-sm">
              <div className="flex justify-center mb-6">
                <div className="rounded-full border border-black/10 bg-black/[0.04] p-4">
                  <BrailleSpinner className="text-5xl text-black/65" />
                </div>
              </div>
              <h1 className="mb-3 text-2xl font-semibold tracking-[-0.03em] text-black/90">
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
