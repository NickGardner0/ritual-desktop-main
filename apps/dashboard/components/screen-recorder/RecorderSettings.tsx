'use client';

/**
 * Screen Recorder Settings Component
 * 
 * Controls for starting/stopping screen recording and configuring options.
 * Matches the minimalistic design of other settings panels.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { 
  Video, 
  Monitor,
  AlertCircle,
  Trash2,
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
