/**
 * Hooks for interacting with the Ritual Recorder sidecar
 * 
 * Provides screen recording with OCR functionality via Tauri commands.
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

// ============================================================
// TYPES
// ============================================================

export interface RecorderConfig {
  device_id: string;
  user_id: string;
  capture_interval_ms: number;
  thumbnail_interval_ms: number;
  video_quality: 'low' | 'medium' | 'high';
  video_chunk_duration_secs: number;
  monitor_id: number;
  enable_dedup: boolean;
  dedup_threshold: number;
  max_frame_gap_secs: number;
  enable_ocr: boolean;
  ocr_language: string;
  storage_limit_gb: number;
  excluded_apps: string[];
}

export interface RecorderStatus {
  is_running: boolean;
  pid: number | null;
  device_id: string | null;
}

export interface OcrFrame {
  id: number;
  timestamp: number;
  activity_event_id: number | null;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  ocr_confidence: number;
  thumbnail_path: string | null;
  video_chunk_id: number | null;
  frame_offset: number | null;
}

export interface VideoChunk {
  id: number;
  file_path: string;
  start_time: number;
  end_time: number | null;
  frame_count: number;
  file_size_bytes: number | null;
  monitor_id: number;
  storage_tier: 'hot' | 'warm' | 'cold';
}

export interface StorageStatus {
  video_bytes: number;
  thumbnail_bytes: number;
  total_bytes: number;
  limit_bytes: number;
  usage_percentage: number;
  frame_count: number;
  video_chunk_count: number;
}

export interface MonitorInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  is_primary: boolean;
}

export interface OcrSearchResult {
  frames: OcrFrame[];
  total_count: number;
}

export interface FfmpegStatus {
  is_installed: boolean;
  version: string | null;
  path: string | null;
  needs_download: boolean;
}

// Extracted frame from video (Screenpipe-style on-demand extraction)
export interface ExtractedFrame {
  data: string;       // Base64 encoded JPEG
  mime_type: string;  // "image/jpeg"
  width: number | null;
  height: number | null;
  from_cache: boolean;
}

export interface FrameCacheStats {
  entry_count: number;
  max_entries: number;
  ttl_seconds: number;
}

// ============================================================
// DEFAULT CONFIG
// ============================================================

export const defaultRecorderConfig: RecorderConfig = {
  device_id: '',
  user_id: '',
  capture_interval_ms: 1000,
  thumbnail_interval_ms: 60000,
  video_quality: 'medium',
  video_chunk_duration_secs: 300,
  monitor_id: 0,
  enable_dedup: true,
  dedup_threshold: 0.02,
  max_frame_gap_secs: 60,
  enable_ocr: true,
  ocr_language: 'en-US',
  storage_limit_gb: 20,
  excluded_apps: [],
};

// ============================================================
// TAURI INVOCATION HELPERS
// ============================================================

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    console.warn(`Tauri command ${command} called in non-Tauri environment`);
    throw new Error('Not running in Tauri');
  }
  return invoke<T>(command, args);
}

// ============================================================
// RECORDER CONTROL HOOKS
// ============================================================

/**
 * Hook for managing the recorder process
 */
export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>({
    is_running: false,
    pid: null,
    device_id: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check status on mount and periodically
  const refreshStatus = useCallback(async () => {
    if (!isTauri) return;
    try {
      const newStatus = await invokeCommand<RecorderStatus>('get_recorder_status');
      setStatus(newStatus);
    } catch (e) {
      console.error('Failed to get recorder status:', e);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const startRecorder = useCallback(async (config: RecorderConfig) => {
    setIsLoading(true);
    setError(null);
    try {
      const newStatus = await invokeCommand<RecorderStatus>('start_recorder', { config });
      setStatus(newStatus);
      return newStatus;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stopRecorder = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const newStatus = await invokeCommand<RecorderStatus>('stop_recorder');
      setStatus(newStatus);
      return newStatus;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    status,
    isLoading,
    error,
    startRecorder,
    stopRecorder,
    refreshStatus,
  };
}

/**
 * Hook for checking screen recording permission
 */
export function useScreenRecordingPermission() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkPermission = useCallback(async () => {
    if (!isTauri) {
      setHasPermission(false);
      return false;
    }
    setIsChecking(true);
    try {
      const result = await invokeCommand<boolean>('check_screen_recording_permission');
      setHasPermission(result);
      return result;
    } catch (e) {
      console.error('Failed to check permission:', e);
      setHasPermission(false);
      return false;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isTauri) return false;
    try {
      await invokeCommand<boolean>('request_screen_recording_permission');
      // Re-check after a delay to give user time to grant permission
      setTimeout(checkPermission, 2000);
      return true;
    } catch (e) {
      console.error('Failed to request permission:', e);
      return false;
    }
  }, [checkPermission]);

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  return {
    hasPermission,
    isChecking,
    checkPermission,
    requestPermission,
  };
}

/**
 * Hook for checking FFmpeg installation status
 */
export function useFfmpegStatus() {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!isTauri) {
      setStatus({ is_installed: false, version: null, path: null, needs_download: true });
      return null;
    }
    setIsChecking(true);
    try {
      const result = await invokeCommand<FfmpegStatus>('check_ffmpeg_status');
      setStatus(result);
      return result;
    } catch (e) {
      console.error('Failed to check FFmpeg status:', e);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const ensureInstalled = useCallback(async () => {
    if (!isTauri) return null;
    setIsInstalling(true);
    try {
      const result = await invokeCommand<FfmpegStatus>('ensure_ffmpeg_installed');
      setStatus(result);
      return result;
    } catch (e) {
      console.error('Failed to ensure FFmpeg installed:', e);
      return null;
    } finally {
      setIsInstalling(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    status,
    isChecking,
    isInstalling,
    checkStatus,
    ensureInstalled,
  };
}

/**
 * Hook for getting available monitors
 */
export function useAvailableMonitors() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMonitors = useCallback(async () => {
    if (!isTauri) return [];
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<MonitorInfo[]>('get_available_monitors');
      setMonitors(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  return {
    monitors,
    isLoading,
    error,
    refetch: fetchMonitors,
  };
}

/**
 * Hook for storage status
 */
export function useRecorderStorage() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isTauri) return null;
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<StorageStatus>('get_recorder_storage_status');
      setStatus(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runMaintenance = useCallback(async () => {
    if (!isTauri) return null;
    try {
      const result = await invokeCommand<string>('run_recorder_maintenance');
      await fetchStatus(); // Refresh status after maintenance
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    }
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refetch: fetchStatus,
    runMaintenance,
  };
}

// ============================================================
// OCR DATA HOOKS
// ============================================================

/**
 * Hook for fetching OCR frames
 */
export function useOcrFrames(startTs: number, endTs: number, limit?: number) {
  const [frames, setFrames] = useState<OcrFrame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFrames = useCallback(async () => {
    if (!isTauri) return [];
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<OcrFrame[]>('get_ocr_frames', {
        startTs,
        endTs,
        limit: limit ?? 500,
      });
      setFrames(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to fetch OCR frames:', errorMsg);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [startTs, endTs, limit]);

  useEffect(() => {
    fetchFrames();
  }, [fetchFrames]);

  return {
    frames,
    isLoading,
    error,
    refetch: fetchFrames,
  };
}

/**
 * Hook for searching OCR text
 */
export function useOcrSearch() {
  const [results, setResults] = useState<OcrSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (
    query: string,
    options?: {
      startTs?: number;
      endTs?: number;
      limit?: number;
    }
  ) => {
    if (!isTauri || !query.trim()) {
      setResults(null);
      return null;
    }
    
    setIsSearching(true);
    setError(null);
    try {
      const result = await invokeCommand<OcrSearchResult>('search_ocr_text', {
        query,
        startTs: options?.startTs,
        endTs: options?.endTs,
        limit: options?.limit ?? 100,
      });
      setResults(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to search OCR text:', errorMsg);
      return null;
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults(null);
    setError(null);
  }, []);

  return {
    results,
    isSearching,
    error,
    search,
    clearResults,
  };
}

/**
 * Hook for fetching video chunks
 */
export function useVideoChunks(startTs: number, endTs: number) {
  const [chunks, setChunks] = useState<VideoChunk[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChunks = useCallback(async () => {
    if (!isTauri) return [];
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<VideoChunk[]>('get_video_chunks', {
        startTs,
        endTs,
      });
      setChunks(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to fetch video chunks:', errorMsg);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [startTs, endTs]);

  useEffect(() => {
    fetchChunks();
  }, [fetchChunks]);

  return {
    chunks,
    isLoading,
    error,
    refetch: fetchChunks,
  };
}

// ============================================================
// CONFIG PERSISTENCE HOOKS
// ============================================================

/**
 * Hook for managing recorder config persistence
 */
export function useRecorderConfig() {
  const [savedConfig, setSavedConfig] = useState<RecorderConfig | null>(null);

  const saveConfig = useCallback(async (config: RecorderConfig) => {
    if (!isTauri) return;
    try {
      await invokeCommand('save_recorder_config_cmd', { config });
      setSavedConfig(config);
    } catch (e) {
      console.error('Failed to save recorder config:', e);
      throw e;
    }
  }, []);

  const clearConfig = useCallback(async () => {
    if (!isTauri) return;
    try {
      await invokeCommand('clear_recorder_config_cmd');
      setSavedConfig(null);
    } catch (e) {
      console.error('Failed to clear recorder config:', e);
      throw e;
    }
  }, []);

  return {
    savedConfig,
    saveConfig,
    clearConfig,
  };
}

// ============================================================
// ON-DEMAND FRAME EXTRACTION (Screenpipe-style)
// ============================================================

/**
 * Extract a frame from video on-demand
 * This is the Screenpipe-style approach - no pre-generated thumbnails,
 * frames are extracted from MP4 video chunks when needed
 */
export async function extractFrameImage(options: {
  frameId?: number;
  videoChunkId?: number;
  frameOffset?: number;
  scale?: number;
}): Promise<ExtractedFrame | null> {
  if (!isTauri) return null;
  
  try {
    const result = await invokeCommand<ExtractedFrame>('extract_frame_image', {
      frameId: options.frameId,
      videoChunkId: options.videoChunkId,
      frameOffset: options.frameOffset,
      scale: options.scale ?? 0.75,
    });
    return result;
  } catch (e) {
    console.error('Failed to extract frame:', e);
    return null;
  }
}

/**
 * Convert extracted frame data to a data URL for display
 */
export function frameToDataUrl(frame: ExtractedFrame): string {
  return `data:${frame.mime_type};base64,${frame.data}`;
}

/**
 * Clear the frame extraction cache
 */
export async function clearFrameCache(): Promise<number> {
  if (!isTauri) return 0;
  try {
    return await invokeCommand<number>('clear_frame_cache');
  } catch (e) {
    console.error('Failed to clear frame cache:', e);
    return 0;
  }
}

/**
 * Get frame cache statistics
 */
export async function getFrameCacheStats(): Promise<FrameCacheStats | null> {
  if (!isTauri) return null;
  try {
    return await invokeCommand<FrameCacheStats>('get_frame_cache_stats');
  } catch (e) {
    console.error('Failed to get frame cache stats:', e);
    return null;
  }
}

/**
 * Hook for on-demand frame extraction with caching
 * Replaces the need for thumbnail_path - extracts frames from video
 */
export function useFrameExtraction(frame: OcrFrame | null) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractFrame = useCallback(async () => {
    if (!frame || !isTauri) {
      setImageUrl(null);
      return null;
    }

    // Need either frame_id or (video_chunk_id + frame_offset)
    if (!frame.id && (!frame.video_chunk_id || frame.frame_offset === null)) {
      setImageUrl(null);
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const extracted = await extractFrameImage({
        frameId: frame.id,
        videoChunkId: frame.video_chunk_id ?? undefined,
        frameOffset: frame.frame_offset ?? undefined,
        scale: 0.75,
      });

      if (extracted) {
        const url = frameToDataUrl(extracted);
        setImageUrl(url);
        return url;
      } else {
        setImageUrl(null);
        return null;
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Frame extraction failed:', errorMsg);
      setImageUrl(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [frame]);

  // Auto-extract when frame changes
  useEffect(() => {
    if (frame && (frame.id || (frame.video_chunk_id && frame.frame_offset !== null))) {
      extractFrame();
    } else {
      setImageUrl(null);
      setError(null);
    }
  }, [extractFrame]); // extractFrame already depends on frame

  return {
    imageUrl,
    isLoading,
    error,
    refetch: extractFrame,
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format timestamp to readable date/time
 */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Get estimated storage per month based on quality
 */
export function getEstimatedStorage(quality: 'low' | 'medium' | 'high'): string {
  const estimates = {
    low: '~3 GB/month',
    medium: '~8 GB/month',
    high: '~15 GB/month',
  };
  return estimates[quality];
}
