'use client';

/**
 * Screen Recorder Settings Component
 * 
 * Controls for starting/stopping screen recording and configuring options.
 * Matches the minimalistic design of other settings panels.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { 
  Video, 
  Monitor,
  AlertCircle,
  Trash2,
  RefreshCw,
  Database,
  Lock
} from 'lucide-react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import {
  useRecorder,
  useScreenRecordingPermission,
  useFfmpegStatus,
  useAvailableMonitors,
  useRecorderStorage,
  useRecorderConfig,
  type RecorderConfig,
  defaultRecorderConfig,
  formatBytes,
  getEstimatedStorage,
} from '@/hooks/use-recorder';

// ============================================================
// TYPES
// ============================================================

interface RecorderSettingsProps {
  userId: string;
  deviceId: string;
  onClose?: () => void;
}

interface ChunkEmbeddingCoverage {
  total_chunks: number;
  embedded_chunks: number;
  pending_chunks: number;
  coverage: number;
  frames_without_embeddings: number;
  worker_running: boolean;
  last_worker_run: number | null;
}

interface BackfillChunkEmbeddingsResult {
  success: boolean;
  lookback_days: number;
  batch_size: number;
  max_batches: number;
  batches_run: number;
  chunks_rebuilt: number;
  queue_seeded: number;
  chunk_embeddings_processed: number;
  chunk_embeddings_failed: number;
  chunk_embeddings_skipped: number;
  total_chunks_before: number;
  total_chunks_after: number;
  embedded_chunks_before: number;
  embedded_chunks_after: number;
  pending_chunks_before: number;
  pending_chunks_after: number;
  coverage_before: number;
  coverage_after: number;
  message: string;
}

interface ChunkEmbeddingBackfillStatus {
  running: boolean;
  started_at: number | null;
  finished_at: number | null;
  last_message: string | null;
  last_error: string | null;
  last_result: BackfillChunkEmbeddingsResult | null;
}

// ============================================================
// CONSTANTS
// ============================================================

const VIDEO_QUALITY_OPTIONS = [
  { value: 'low', label: 'Low', description: getEstimatedStorage('low') },
  { value: 'medium', label: 'Medium', description: getEstimatedStorage('medium') },
  { value: 'high', label: 'High', description: getEstimatedStorage('high') },
] as const;

const isTauri = typeof window !== 'undefined' && Boolean(
  (window as { __TAURI__?: unknown; __TAURI_IPC__?: unknown }).__TAURI__ ||
  (window as { __TAURI__?: unknown; __TAURI_IPC__?: unknown }).__TAURI_IPC__,
);

// ============================================================
// MAIN COMPONENT
// ============================================================

export function RecorderSettings({
  userId,
  deviceId,
  onClose,
}: RecorderSettingsProps) {
  // State
  const [config, setConfig] = useState<RecorderConfig>({
    ...defaultRecorderConfig,
    user_id: userId,
    device_id: deviceId,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Hooks
  const { status, isLoading, error, startRecorder, stopRecorder } = useRecorder();
  const { hasPermission, requestPermission } = useScreenRecordingPermission();
  const { status: ffmpegStatus, isInstalling: ffmpegInstalling } = useFfmpegStatus();
  const { monitors } = useAvailableMonitors();
  const { status: storageStatus, runMaintenance } = useRecorderStorage();
  const { saveConfig, clearConfig } = useRecorderConfig();
  const [isCleaning, setIsCleaning] = useState(false);
  const [semanticCoverage, setSemanticCoverage] = useState<ChunkEmbeddingCoverage | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticRebuilding, setSemanticRebuilding] = useState(false);
  const [semanticBackfillStatus, setSemanticBackfillStatus] = useState<ChunkEmbeddingBackfillStatus | null>(null);
  const [semanticMessage, setSemanticMessage] = useState<string | null>(null);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  // Update config with userId/deviceId
  useEffect(() => {
    setConfig(prev => ({
      ...prev,
      user_id: userId,
      device_id: deviceId,
    }));
  }, [userId, deviceId]);

  // Handlers
  const handleToggleRecording = useCallback(async () => {
    if (status.is_running) {
      await stopRecorder();
      await clearConfig();
    } else {
      await startRecorder(config);
    }
  }, [status.is_running, config, startRecorder, stopRecorder, clearConfig]);

  const handleRunMaintenance = useCallback(async () => {
    try {
      setIsCleaning(true);
      await runMaintenance();
    } catch (e) {
      console.error('Maintenance failed:', e);
    } finally {
      setIsCleaning(false);
    }
  }, [runMaintenance]);

  const updateConfig = useCallback(<K extends keyof RecorderConfig>(
    key: K,
    value: RecorderConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const fetchSemanticCoverage = useCallback(async (silent = false) => {
    if (!isTauri) return null;

    if (!silent) setSemanticLoading(true);
    try {
      const result = await invoke<ChunkEmbeddingCoverage>('get_chunk_embedding_coverage');
      setSemanticCoverage(result);
      return result;
    } catch (e) {
      console.error('Failed to fetch semantic coverage:', e);
      if (!silent) {
        const msg = e instanceof Error ? e.message : String(e);
        setSemanticError(msg);
      }
      return null;
    } finally {
      if (!silent) setSemanticLoading(false);
    }
  }, []);

  const fetchSemanticBackfillStatus = useCallback(async (silent = false) => {
    if (!isTauri) return null;
    try {
      const result = await invoke<ChunkEmbeddingBackfillStatus>('get_chunk_embedding_backfill_status');
      setSemanticBackfillStatus(result);
      if (!silent) {
        if (result.last_error) {
          setSemanticError(result.last_error);
        }
      }
      return result;
    } catch (e) {
      console.error('Failed to fetch semantic backfill status:', e);
      if (!silent) {
        const msg = e instanceof Error ? e.message : String(e);
        setSemanticError(msg);
      }
      return null;
    }
  }, []);

  const handleRebuildSemanticIndex = useCallback(async () => {
    if (!isTauri || semanticRebuilding || semanticBackfillStatus?.running) return;

    setSemanticError(null);
    setSemanticMessage('Starting semantic index repair...');
    setSemanticRebuilding(true);

    try {
      await invoke('ensure_embedding_pipeline_ready');
      const startMessage = await invoke<string>('start_chunk_embedding_backfill', {
        batchSize: 200,
        maxBatches: 600,
        lookbackDays: 3650,
      });
      setSemanticMessage(startMessage || 'Semantic index repair started in background.');
      await fetchSemanticBackfillStatus(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSemanticError(msg);
      setSemanticMessage(null);
    } finally {
      setSemanticRebuilding(false);
      void fetchSemanticCoverage(true);
      void fetchSemanticBackfillStatus(true);
    }
  }, [fetchSemanticBackfillStatus, fetchSemanticCoverage, semanticBackfillStatus?.running, semanticRebuilding]);

  useEffect(() => {
    if (!isTauri) return;
    void fetchSemanticCoverage();
    void fetchSemanticBackfillStatus(true);
    const pollMs = semanticBackfillStatus?.running ? 1500 : 5000;
    const interval = window.setInterval(() => {
      void fetchSemanticCoverage(true);
      void fetchSemanticBackfillStatus(true);
    }, pollMs);
    return () => window.clearInterval(interval);
  }, [fetchSemanticBackfillStatus, fetchSemanticCoverage, semanticBackfillStatus?.running]);

  const semanticIsCatchingUp = useMemo(() => {
    if (!semanticCoverage) return true;
    if (semanticBackfillStatus?.running) return true;
    if (semanticCoverage.pending_chunks > 25) return true;
    if (semanticCoverage.frames_without_embeddings > 100) return true;
    if (semanticCoverage.total_chunks >= 200 && semanticCoverage.coverage < 0.95) return true;
    return false;
  }, [semanticBackfillStatus?.running, semanticCoverage]);

  const rowClass = 'flex items-center justify-between py-2.5';
  const sectionClass = 'rounded-none border border-gray-200/70 bg-white px-3';

  return (
    <div className="space-y-3 pb-1">
      {error && (
        <div className="py-2 flex items-center gap-2 text-red-500 text-xs">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}

      <section className={sectionClass}>
        <div className="pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-gray-500">Core</div>

        <div className={rowClass}>
          <div className="flex items-center gap-2 text-[13px] text-gray-900">
            <Video className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-medium">Screen Recording</span>
            {status.is_running && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
          </div>
          {isLoading ? (
            <BrailleSpinner className="text-xs text-gray-400" />
          ) : (
            <button
              onClick={handleToggleRecording}
              disabled={!hasPermission}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                status.is_running ? 'bg-black' : 'bg-gray-300'
              } ${!hasPermission ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  status.is_running ? 'translate-x-[18px]' : 'translate-x-1'
                }`}
              />
            </button>
          )}
        </div>

        <div className="border-t border-gray-200/60 py-2">
          <div className="mb-1 text-[12px] text-gray-600">Video quality</div>
          <div className="grid grid-cols-3 gap-1">
            {VIDEO_QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => updateConfig('video_quality', option.value)}
                className={`h-8 px-2 text-[12px] border rounded-none transition-colors ${
                  config.video_quality === option.value
                    ? 'border-gray-900 bg-gray-100 text-gray-900'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {VIDEO_QUALITY_OPTIONS.find((o) => o.value === config.video_quality)?.description}
          </p>
        </div>

        <div className="border-t border-gray-200/60">
          <div className={rowClass}>
            <span className="text-[13px] text-gray-900">Text Extraction (OCR)</span>
            <button
              onClick={() => updateConfig('enable_ocr', !config.enable_ocr)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                config.enable_ocr ? 'bg-black' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  config.enable_ocr ? 'translate-x-[18px]' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="border-t border-gray-200/60" />

          <div className={rowClass}>
            <span className="text-[13px] text-gray-900">Skip Similar Frames</span>
            <button
              onClick={() => updateConfig('enable_dedup', !config.enable_dedup)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                config.enable_dedup ? 'bg-black' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  config.enable_dedup ? 'translate-x-[18px]' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-gray-500">Health</div>
        <div className={rowClass}>
          <div className="flex items-center gap-2 text-[13px] text-gray-900">
            <Database className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-medium">Semantic Index</span>
          </div>
          {semanticLoading ? (
            <BrailleSpinner className="text-xs text-gray-400" />
          ) : (
            <span className={`text-[11px] ${semanticIsCatchingUp ? 'text-amber-700' : 'text-emerald-700'}`}>
              {semanticIsCatchingUp ? 'Catching up' : 'Healthy'}
            </span>
          )}
        </div>

        {semanticCoverage && (
          <div className="pb-2 text-[11px] text-gray-500">
            {semanticCoverage.embedded_chunks}/{semanticCoverage.total_chunks} chunks embedded
            {semanticCoverage.pending_chunks > 0 ? ` · ${semanticCoverage.pending_chunks} pending` : ''}
          </div>
        )}

        {(semanticError || semanticMessage) && (
          <p className={`pb-2 text-[11px] ${semanticError ? 'text-red-500' : 'text-gray-500'}`}>
            {semanticError || semanticMessage}
          </p>
        )}

        <div className="border-t border-gray-200/60 pt-2 pb-2 flex justify-end">
          <button
            onClick={handleRebuildSemanticIndex}
            disabled={!isTauri || semanticRebuilding || semanticBackfillStatus?.running}
            className="h-8 px-3 text-[12px] text-gray-700 border border-gray-300 rounded-none hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {semanticRebuilding || semanticBackfillStatus?.running ? (
              <BrailleSpinner className="text-xs" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            {semanticRebuilding || semanticBackfillStatus?.running ? 'Repairing...' : 'Repair index'}
          </button>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-gray-500">Storage</div>
        <div className={rowClass}>
          <span className="text-[13px] font-medium text-gray-900">Usage</span>
          {storageStatus && (
            <span className="text-[12px] text-gray-500">
              {formatBytes(storageStatus.total_bytes)} / {formatBytes(storageStatus.limit_bytes)}
            </span>
          )}
        </div>
        {storageStatus && (
          <div className="pb-2">
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gray-900 transition-all"
                style={{ width: `${storageStatus.usage_percentage}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-gray-500">
              <span>{storageStatus.usage_percentage}% used</span>
              <span>{storageStatus.frame_count} frames</span>
            </div>
          </div>
        )}
      </section>

      <button
        onClick={() => setShowAdvanced((prev) => !prev)}
        className="w-full h-8 px-1 text-left text-[12px] text-gray-500 hover:text-gray-700 transition-colors"
      >
        {showAdvanced ? 'Hide advanced settings' : 'Show advanced settings'}
      </button>

      {showAdvanced && (
        <section className={sectionClass}>
          <div className="pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-gray-500">Advanced</div>

          <div className={rowClass}>
            <div className="flex items-center gap-2 text-[13px] text-gray-900">
              <Lock className="w-3.5 h-3.5 text-gray-400" />
              <span>Screen Permission</span>
            </div>
            {hasPermission === null ? (
              <BrailleSpinner className="text-xs text-gray-400" />
            ) : hasPermission ? (
              <span className="text-[12px] text-gray-500">Granted</span>
            ) : (
              <button onClick={requestPermission} className="text-[12px] text-gray-600 hover:text-gray-900">
                Open Settings
              </button>
            )}
          </div>

          <div className="border-t border-gray-200/60" />

          <div className={rowClass}>
            <span className="text-[13px] text-gray-900">Video Encoder</span>
            {ffmpegInstalling ? (
              <div className="flex items-center gap-1.5">
                <BrailleSpinner className="text-xs text-gray-400" />
                <span className="text-[12px] text-gray-500">Downloading...</span>
              </div>
            ) : ffmpegStatus === null ? (
              <BrailleSpinner className="text-xs text-gray-400" />
            ) : ffmpegStatus.is_installed ? (
              <span className="text-[12px] text-gray-500">FFmpeg {ffmpegStatus.version || 'Ready'}</span>
            ) : (
              <span className="text-[12px] text-gray-500">Pending install</span>
            )}
          </div>

          {monitors.length > 1 && (
            <>
              <div className="border-t border-gray-200/60" />
              <div className="py-2">
                <div className="mb-1 text-[12px] text-gray-600">Monitor</div>
                <div className="grid grid-cols-2 gap-1">
                  {monitors.map((monitor) => (
                    <button
                      key={monitor.id}
                      onClick={() => updateConfig('monitor_id', monitor.id)}
                      className={`rounded-none border px-2 py-1 text-left text-[11px] transition-colors ${
                        config.monitor_id === monitor.id
                          ? 'border-gray-900 bg-gray-100 text-gray-900'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <div className="truncate">{monitor.name}</div>
                      <div className="text-gray-400">{monitor.width}x{monitor.height}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="border-t border-gray-200/60" />

          <div className="py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[13px] text-gray-900">Storage Limit</span>
              <span className="text-[12px] text-gray-500">{config.storage_limit_gb} GB</span>
            </div>
            <input
              type="range"
              min="5"
              max="100"
              step="5"
              value={config.storage_limit_gb}
              onChange={(e) => updateConfig('storage_limit_gb', parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-black"
            />
          </div>

          <div className="border-t border-gray-200/60 pt-2 pb-2 flex justify-between items-center">
            <button
              onClick={handleRunMaintenance}
              disabled={isCleaning}
              className="h-8 px-3 text-[12px] text-gray-700 border border-gray-300 rounded-none hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isCleaning ? <BrailleSpinner className="text-xs" /> : <Trash2 className="w-3 h-3" />}
              {isCleaning ? 'Cleaning...' : 'Cleanup'}
            </button>

            {onClose && (
              <button onClick={onClose} className="text-[12px] text-gray-600 hover:text-gray-900 transition-colors">
                Done
              </button>
            )}
          </div>
        </section>
      )}

      {!showAdvanced && onClose && (
        <div className="flex justify-end pr-1">
          <button onClick={onClose} className="text-[12px] text-gray-600 hover:text-gray-900 transition-colors">
            Done
          </button>
        </div>
      )}
    </div>
  );
}

export default RecorderSettings;
