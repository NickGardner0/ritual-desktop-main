'use client';

import { Copy, Download, X } from 'lucide-react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

export function MetricsShareModal({
  copyShareImage,
  copyState,
  closeShareModal,
  downloadShareImage,
  downloadState,
  isCapturing,
  shareImageUrl,
  shareLabel,
}: {
  copyShareImage: () => void;
  copyState: 'idle' | 'copied' | 'failed';
  closeShareModal: () => void;
  downloadShareImage: () => void;
  downloadState: 'idle' | 'done' | 'failed';
  isCapturing: boolean;
  shareImageUrl: string | null;
  shareLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200"
        onClick={closeShareModal}
      />
      <div className="relative z-10 w-[min(92vw,680px)] max-h-[86vh] overflow-hidden rounded-xl border border-[rgba(39,37,30,0.08)] bg-white p-4 sm:p-5 shadow-[0_24px_48px_rgba(0,0,0,0.12),0_8px_16px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[20px] font-semibold leading-[1.1] tracking-[-0.4px] text-[#27251E]">
            Share screenshot
          </h2>
          <button
            type="button"
            onClick={closeShareModal}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[rgba(39,37,30,0.08)] bg-white text-[rgba(39,37,30,0.4)] transition-all duration-150 hover:bg-[#F3F3F3] hover:text-[#27251E]"
            aria-label="Close share screenshot modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2.5 bg-white">
          {isCapturing ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <div className="text-center">
                <BrailleSpinner className="mx-auto text-[30px] text-[rgba(39,37,30,0.6)]" />
                <p className="mt-2 text-sm text-[rgba(39,37,30,0.62)]">Preparing screenshot...</p>
              </div>
            </div>
          ) : shareImageUrl ? (
            <div className="max-h-[52vh] overflow-auto">
              <img
                src={shareImageUrl}
                alt={`${shareLabel} chart screenshot preview`}
                className="block h-auto w-full rounded-sm object-contain"
              />
            </div>
          ) : (
            <div className="flex min-h-[220px] items-center justify-center text-sm text-[rgba(39,37,30,0.62)]">
              Couldn&apos;t prepare screenshot preview.
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={copyShareImage}
            disabled={!shareImageUrl || isCapturing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-[rgba(39,37,30,0.08)] bg-white px-3 text-[13px] font-medium tracking-[-0.2px] text-[#2E2C24] transition-all duration-150 hover:bg-[#F3F3F3] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy image'}
          </button>

          <button
            type="button"
            onClick={downloadShareImage}
            disabled={!shareImageUrl || isCapturing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#27251E] px-3 text-[13px] font-medium tracking-[-0.2px] text-white transition-all duration-150 hover:bg-[#3a3830] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {downloadState === 'done' ? 'Downloaded!' : downloadState === 'failed' ? 'Download failed' : 'Download image'}
          </button>
        </div>
      </div>
    </div>
  );
}
