"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import {
  getDesktopAssetRecoveryErrorText,
  isRecoverableDesktopAssetError,
  scheduleDesktopAssetRecoveryReload,
} from '@/lib/desktop-asset-recovery';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ChunkErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    if (isRecoverableDesktopAssetError(error)) {
      return { hasError: true, error };
    }
    return { hasError: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isRecoverableDesktopAssetError(error)) {
      console.error('Chunk load error caught:', error, errorInfo);
      scheduleDesktopAssetRecoveryReload(error, 'chunk-boundary');
    }
  }

  public render() {
    if (this.state.hasError) {
      const errorText = this.state.error
        ? getDesktopAssetRecoveryErrorText(this.state.error)
        : '';

      return (
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="text-center p-8">
            <div className="w-16 h-16 mx-auto mb-4 text-gray-400">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <h2 className="text-xl font-medium text-gray-900 mb-2">
              Refreshing application
            </h2>
            <p className="text-gray-500 mb-4">
              Ritual detected a stale desktop asset bundle and is reloading automatically...
            </p>
            {process.env.NODE_ENV === 'development' && errorText ? (
              <pre className="mx-auto mb-4 max-w-3xl overflow-auto rounded-lg bg-red-50 p-4 text-left text-xs text-red-700">
                {errorText}
              </pre>
            ) : null}
            <BrailleSpinner className="mx-auto text-lg text-gray-600" />
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChunkErrorBoundary;
