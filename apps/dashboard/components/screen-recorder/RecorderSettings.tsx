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
  VideoOff,
  Monitor,
  HardDrive,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
  Trash2,
  RefreshCw,
  Lock,
  Settings2
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
  type FfmpegStatus,
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

  // Custom square checkbox component
  const SquareCheckbox = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
      type="button"
      onClick={onChange}
      className={`w-4 h-4 border flex items-center justify-center transition-colors ${
        checked ? 'bg-black border-black' : 'bg-white border-gray-300'
      }`}
    >
      {checked && <Check className="w-3 h-3 text-white" />}
    </button>
  );

  return (
    <div className="space-y-0">
      {/* Error display */}
      {error && (
        <div className="py-2 flex items-center gap-2 text-red-500 text-sm border-b border-gray-200/50">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Screen Recording Permission */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">Screen Permission</span>
        </div>
        {hasPermission === null ? (
          <BrailleSpinner className="text-sm text-gray-400" />
        ) : hasPermission ? (
          <span className="text-sm text-gray-500">Granted</span>
        ) : (
          <button
            onClick={requestPermission}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Open Settings
          </button>
        )}
      </div>

      {/* FFmpeg Status */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">Video Encoder</span>
        </div>
        {ffmpegInstalling ? (
          <div className="flex items-center gap-1.5">
            <BrailleSpinner className="text-xs text-gray-400" />
            <span className="text-sm text-gray-500">Downloading...</span>
          </div>
        ) : ffmpegStatus === null ? (
          <BrailleSpinner className="text-sm text-gray-400" />
        ) : ffmpegStatus.is_installed ? (
          <span className="text-sm text-gray-500">
            FFmpeg {ffmpegStatus.version || 'Ready'}
          </span>
        ) : (
          <span className="text-sm text-gray-500">Will download on start</span>
        )}
      </div>

      {/* Enable Recording */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status.is_running ? (
            <VideoOff className="w-4 h-4 text-gray-400" />
          ) : (
            <Video className="w-4 h-4 text-gray-400" />
          )}
          <span className="text-sm text-gray-900">Screen Recording</span>
          {status.is_running && (
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" title="Recording" />
          )}
        </div>
        {isLoading ? (
          <div className="h-5 w-9 flex items-center justify-center">
            <BrailleSpinner className="text-sm text-gray-400" />
          </div>
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

      {/* Video Quality */}
      <div className="py-2.5 border-b border-gray-200/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-900">Video Quality</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {VIDEO_QUALITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => updateConfig('video_quality', option.value)}
              className={`py-1.5 px-2 text-xs text-center border transition-colors ${
                config.video_quality === option.value
                  ? 'border-gray-900 bg-gray-100 text-gray-900'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          {VIDEO_QUALITY_OPTIONS.find(o => o.value === config.video_quality)?.description}
        </p>
      </div>

      {/* OCR */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {config.enable_ocr ? (
            <Eye className="w-4 h-4 text-gray-400" />
          ) : (
            <EyeOff className="w-4 h-4 text-gray-400" />
          )}
          <span className="text-sm text-gray-900">Text Extraction (OCR)</span>
        </div>
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

      {/* Frame Deduplication */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">Skip Similar Frames</span>
        </div>
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

      {/* Monitor Selection - only show if multiple monitors */}
      {monitors.length > 1 && (
        <div className="py-2.5 border-b border-gray-200/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-900">Monitor</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {monitors.map((monitor) => (
              <button
                key={monitor.id}
                onClick={() => updateConfig('monitor_id', monitor.id)}
                className={`py-1.5 px-2 text-xs text-left border transition-colors ${
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
      )}

      {/* Storage */}
      <div className="py-2.5 border-b border-gray-200/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-900">Storage</span>
          </div>
          {storageStatus && (
            <span className="text-sm text-gray-500">
              {storageStatus.usage_percentage}%
            </span>
          )}
        </div>
        {storageStatus && (
          <>
            <div className="w-full h-1.5 bg-gray-200 overflow-hidden">
              <div 
                className="h-full bg-gray-900 transition-all"
                style={{ width: `${storageStatus.usage_percentage}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1.5">
              <span>{formatBytes(storageStatus.total_bytes)} used</span>
              <span>{formatBytes(storageStatus.limit_bytes)} limit</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{storageStatus.frame_count} frames</span>
              <span>{storageStatus.video_chunk_count} videos</span>
            </div>
          </>
        )}
      </div>

      {/* Storage Limit */}
      <div className="py-2.5 border-b border-gray-200/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-900">Storage Limit</span>
          <span className="text-sm text-gray-500">{config.storage_limit_gb} GB</span>
        </div>
        <input
          type="range"
          min="5"
          max="100"
          step="5"
          value={config.storage_limit_gb}
          onChange={(e) => updateConfig('storage_limit_gb', parseInt(e.target.value))}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-black"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>5 GB</span>
          <span>50 GB</span>
          <span>100 GB</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-3">
        <button
          onClick={handleRunMaintenance}
          disabled={isCleaning}
          className="px-2.5 py-1 text-xs text-gray-700 border border-gray-300 hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {isCleaning ? (
            <BrailleSpinner className="text-xs" />
          ) : (
            <Trash2 className="w-3 h-3" />
          )}
          {isCleaning ? 'Cleaning...' : 'Cleanup'}
        </button>
        
        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

export default RecorderSettings;
