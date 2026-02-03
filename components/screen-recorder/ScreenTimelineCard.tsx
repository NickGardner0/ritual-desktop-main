'use client';

/**
 * Screen Timeline Card
 * 
 * Video player-style card for screen recordings with waveform scrubber.
 * Implements Screenpipe-style on-demand frame extraction with:
 * - Time tooltip on hover
 * - Pre-caching nearby frames
 * - Playback functionality
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Play, Pause, Volume2 } from 'lucide-react';
import {
  useRecorder,
  useOcrFrames,
  useFrameExtraction,
  extractFrameImage,
  frameToDataUrl,
  type OcrFrame,
} from '@/hooks/use-recorder';
import { cn } from '@/lib/utils';

// ============================================================
// TYPES
// ============================================================

interface ScreenTimelineCardProps {
  startDate?: Date;
  endDate?: Date;
  className?: string;
}

// ============================================================
// FRAME CACHE - Pre-cache nearby frames for smooth scrubbing
// ============================================================

const frameCache = new Map<string, string>(); // frameId -> dataUrl
const MAX_CACHE_SIZE = 50;

async function prefetchFrame(frame: OcrFrame | null) {
  if (!frame || !frame.id) return;
  const cacheKey = `${frame.id}`;
  if (frameCache.has(cacheKey)) return;
  
  try {
    const extracted = await extractFrameImage({
      frameId: frame.id,
      scale: 0.5, // Smaller for prefetch
    });
    if (extracted) {
      // Evict oldest if at capacity
      if (frameCache.size >= MAX_CACHE_SIZE) {
        const firstKey = frameCache.keys().next().value;
        if (firstKey) frameCache.delete(firstKey);
      }
      frameCache.set(cacheKey, frameToDataUrl(extracted));
    }
  } catch {
    // Ignore prefetch errors
  }
}

function getCachedFrame(frame: OcrFrame | null): string | null {
  if (!frame || !frame.id) return null;
  return frameCache.get(`${frame.id}`) || null;
}

// ============================================================
// WAVEFORM SCRUBBER WITH TOOLTIP (Debounced for performance)
// ============================================================

interface WaveformScrubberProps {
  frames: OcrFrame[];
  hoveredIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  selectedIndex: number | null;
  onSelectIndex: (index: number) => void;
  isPlaying?: boolean;
}

// Debounce delay for frame extraction (ms)
// Tooltip updates immediately, but frame extraction is debounced
const EXTRACTION_DEBOUNCE_MS = 150;

function WaveformScrubber({ 
  frames, 
  hoveredIndex,
  onHoverIndex,
  selectedIndex,
  onSelectIndex,
  isPlaying = false,
}: WaveformScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltipX, setTooltipX] = useState<number>(0);
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  
  // Dense bars for waveform look - compact sizing
  const numBars = 80;
  const svgHeight = 24;
  const barMaxHeight = 18;
  
  // Get the current frame for tooltip (uses tooltipIndex for instant feedback)
  const currentTooltipFrame = useMemo(() => {
    if (tooltipIndex !== null && frames[tooltipIndex]) {
      return frames[tooltipIndex];
    }
    return null;
  }, [tooltipIndex, frames]);
  
  // Format timestamp for tooltip
  const formatTooltipTime = useCallback((timestamp: number) => {
    return format(new Date(timestamp), 'h:mm:ss a');
  }, []);
  
  // Calculate position for playhead (visual only, instant update)
  const playheadPosition = useMemo(() => {
    // Use tooltipIndex for instant visual feedback during hover
    if (tooltipIndex !== null && frames.length > 0) {
      return (tooltipIndex / frames.length) * 100;
    }
    if (selectedIndex !== null && frames.length > 0) {
      return (selectedIndex / frames.length) * 100;
    }
    return 0;
  }, [tooltipIndex, selectedIndex, frames.length]);
  
  // Generate varying bar heights for waveform look
  const barHeights = useMemo(() => {
    const heights: number[] = [];
    for (let i = 0; i < numBars; i++) {
      // Create natural waveform variation using sine waves
      const wave1 = Math.sin(i * 0.15) * 0.3;
      const wave2 = Math.sin(i * 0.08 + 1) * 0.25;
      const wave3 = Math.sin(i * 0.25 + 2) * 0.15;
      const combined = 0.4 + wave1 + wave2 + wave3;
      heights.push(Math.max(0.15, Math.min(1, combined)));
    }
    return heights;
  }, []);
  
  // Map position to frame index
  const positionToFrameIndex = useCallback((x: number, width: number): number => {
    if (frames.length === 0) return 0;
    const ratio = Math.max(0, Math.min(1, x / width));
    return Math.floor(ratio * frames.length);
  }, [frames.length]);
  
  // Handle mouse move - tooltip updates immediately, extraction is debounced
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!containerRef.current || frames.length === 0) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frameIndex = positionToFrameIndex(x, rect.width);
    
    // Update tooltip position and index immediately (cheap, no extraction)
    setTooltipX(x);
    setTooltipIndex(frameIndex);
    
    // Debounce the actual frame extraction
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onHoverIndex(frameIndex);
      
      // Prefetch nearby frames when settling on a position
      const nearbyIndices = [frameIndex - 2, frameIndex - 1, frameIndex + 1, frameIndex + 2];
      nearbyIndices.forEach(idx => {
        if (idx >= 0 && idx < frames.length) {
          prefetchFrame(frames[idx]);
        }
      });
    }, EXTRACTION_DEBOUNCE_MS);
  }, [frames, positionToFrameIndex, onHoverIndex]);
  
  const handlePointerLeave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setTooltipIndex(null);
    onHoverIndex(null);
  }, [onHoverIndex]);
  
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || frames.length === 0) return;
    // Cancel any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frameIndex = positionToFrameIndex(x, rect.width);
    onSelectIndex(frameIndex);
  }, [frames.length, positionToFrameIndex, onSelectIndex]);
  
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
  
  const bars = useMemo(() => Array.from({ length: numBars }, (_, i) => i), []);
  
  return (
    <div className="relative w-full">
      {/* Tooltip - shows app name and time (instant update) */}
      {currentTooltipFrame && tooltipIndex !== null && (
        <div 
          className="absolute bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-50 pointer-events-none"
          style={{ 
            left: `${tooltipX}px`, 
            transform: 'translateX(-50%)',
          }}
        >
          <div className="font-medium">{currentTooltipFrame.app_name || 'Unknown'}</div>
          <div className="text-gray-400">{formatTooltipTime(currentTooltipFrame.timestamp)}</div>
        </div>
      )}
      
      <div
        ref={containerRef}
        className="relative w-full cursor-pointer select-none"
        style={{ height: `${svgHeight}px` }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      >
        <svg 
          viewBox={`0 0 ${numBars * 3} ${svgHeight}`} 
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          {bars.map((i) => {
            const heightFactor = barHeights[i];
            const barHeight = heightFactor * barMaxHeight;
            const x = i * 3;
            const yTop = (svgHeight - barHeight) / 2;
            
            return (
              <rect
                key={i}
                x={x}
                y={yTop}
                width={2}
                height={barHeight}
                fill="#9CA3AF"
                opacity={0.5}
              />
            );
          })}
        </svg>
        
        {/* Playhead line (instant visual feedback) */}
        <div 
          className={cn(
            "absolute top-0 w-0.5 h-full pointer-events-none",
            isPlaying ? "bg-green-400" : "bg-amber-400"
          )}
          style={{ left: `${playheadPosition}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// BATCH PRE-LOADING - Load key frames on timeline init
// ============================================================

async function preloadKeyFrames(frames: OcrFrame[], count: number = 20) {
  if (frames.length === 0) return;
  
  // Sample evenly distributed frames for preloading
  const step = Math.max(1, Math.floor(frames.length / count));
  const indicesToPreload: number[] = [];
  
  for (let i = 0; i < frames.length && indicesToPreload.length < count; i += step) {
    indicesToPreload.push(i);
  }
  
  // Also always include first and last
  if (!indicesToPreload.includes(0)) indicesToPreload.unshift(0);
  if (!indicesToPreload.includes(frames.length - 1)) indicesToPreload.push(frames.length - 1);
  
  console.log(`[ScreenTimeline] Pre-loading ${indicesToPreload.length} key frames...`);
  
  // Load in batches of 5 to avoid overwhelming the system
  for (let i = 0; i < indicesToPreload.length; i += 5) {
    const batch = indicesToPreload.slice(i, i + 5);
    await Promise.all(batch.map(idx => prefetchFrame(frames[idx])));
    // Small delay between batches
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`[ScreenTimeline] Pre-loading complete`);
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function ScreenTimelineCard({ startDate, endDate, className }: ScreenTimelineCardProps) {
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  const [hoveredFrameIndex, setHoveredFrameIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastValidImageUrl, setLastValidImageUrl] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const preloadedRef = useRef(false);

  // Get recorder status
  const { status: recorderStatus } = useRecorder();

  // Calculate time range
  const startTs = startDate ? startOfDay(startDate).getTime() : startOfDay(new Date()).getTime();
  const endTs = endDate ? endOfDay(endDate).getTime() : endOfDay(new Date()).getTime();

  // Fetch OCR frames
  const { frames, isLoading } = useOcrFrames(startTs, endTs, 500);
  
  // Filter to frames that can be extracted (have video chunk and offset)
  // This is Screenpipe-style: no pre-generated thumbnails, extract on-demand
  const extractableFrames = useMemo(() => 
    frames.filter(f => f.video_chunk_id !== null && f.frame_offset !== null),
    [frames]
  );

  // Pre-load key frames when timeline first gets frames (warms up cache)
  useEffect(() => {
    if (extractableFrames.length > 0 && !preloadedRef.current && !isPreloading) {
      preloadedRef.current = true;
      setIsPreloading(true);
      preloadKeyFrames(extractableFrames, 20).finally(() => {
        setIsPreloading(false);
      });
    }
  }, [extractableFrames.length, isPreloading]);

  // Get the frame to display (hovered takes priority over selected)
  const displayFrameIndex = hoveredFrameIndex ?? selectedFrameIndex ?? 0;
  const displayFrame = extractableFrames[displayFrameIndex] || extractableFrames[0] || null;
  
  // Check cache first for instant display
  const cachedImageUrl = useMemo(() => getCachedFrame(displayFrame), [displayFrame]);
  
  // Extract frame image on-demand (Screenpipe-style)
  const { 
    imageUrl: extractedImageUrl, 
    isLoading: isExtractingFrame,
    error: extractionError 
  } = useFrameExtraction(displayFrame);

  // Use cached image if available, otherwise extracted
  const currentImageUrl = cachedImageUrl || extractedImageUrl;
  
  // Keep track of last valid image to show while loading
  useEffect(() => {
    if (currentImageUrl) {
      setLastValidImageUrl(currentImageUrl);
    }
  }, [currentImageUrl]);

  // Playback functionality - faster with aggressive prefetching
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      // Stop playing
      setIsPlaying(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    } else {
      // Start playing
      setIsPlaying(true);
      const startIndex = selectedFrameIndex ?? 0;
      let currentIdx = startIndex;
      
      // Prefetch ahead before starting
      for (let i = 1; i <= 10; i++) {
        if (currentIdx + i < extractableFrames.length) {
          prefetchFrame(extractableFrames[currentIdx + i]);
        }
      }
      
      playIntervalRef.current = setInterval(() => {
        currentIdx++;
        if (currentIdx >= extractableFrames.length) {
          // Loop back to start or stop
          currentIdx = 0;
          setIsPlaying(false);
          if (playIntervalRef.current) {
            clearInterval(playIntervalRef.current);
            playIntervalRef.current = null;
          }
          return;
        }
        setSelectedFrameIndex(currentIdx);
        
        // Aggressively prefetch next frames (10 ahead)
        for (let i = 1; i <= 10; i++) {
          if (currentIdx + i < extractableFrames.length) {
            prefetchFrame(extractableFrames[currentIdx + i]);
          }
        }
      }, 500); // 2 frames per second (faster playback)
    }
  }, [isPlaying, selectedFrameIndex, extractableFrames]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  // Stop playing when hovering
  useEffect(() => {
    if (hoveredFrameIndex !== null && isPlaying) {
      setIsPlaying(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
  }, [hoveredFrameIndex, isPlaying]);

  // Format duration
  const formatDuration = useCallback((ms: number): string => {
    if (ms <= 0 || !isFinite(ms)) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);
  
  // Calculate total duration
  const totalDuration = useMemo(() => {
    if (extractableFrames.length < 2) return '0:00';
    const firstTs = extractableFrames[0].timestamp;
    const lastTs = extractableFrames[extractableFrames.length - 1].timestamp;
    return formatDuration(lastTs - firstTs);
  }, [extractableFrames, formatDuration]);

  // Calculate current time position
  const currentTimePosition = useMemo(() => {
    if (!extractableFrames.length) return '0:00';
    const idx = displayFrameIndex;
    if (idx === 0 || !extractableFrames[0]) return '0:00';
    const firstTs = extractableFrames[0].timestamp;
    const currentTs = extractableFrames[Math.min(idx, extractableFrames.length - 1)]?.timestamp ?? firstTs;
    return formatDuration(currentTs - firstTs);
  }, [displayFrameIndex, extractableFrames, formatDuration]);

  // Don't render if nothing to show
  if (!recorderStatus.is_running && extractableFrames.length === 0 && !isLoading) {
    return null;
  }

  const hasFrames = extractableFrames.length > 0;
  // Only show spinner if we don't have a cached/last image to display
  const showSpinner = isLoading || (isExtractingFrame && !lastValidImageUrl && !cachedImageUrl);
  const displayImageUrl = currentImageUrl || lastValidImageUrl;

  return (
    <div className={cn("bg-white py-6", className)}>
      {/* Centered video container */}
      <div className="max-w-md mx-auto px-4">
        {/* Video preview - rounded with shadow */}
        <div className="relative rounded-xl overflow-hidden shadow-sm">
          <div className="aspect-[4/3]">
            {/* Show last valid image with loading overlay */}
            {displayImageUrl ? (
              <>
                <img
                  src={displayImageUrl}
                  alt="Screen capture"
                  className={cn(
                    "w-full h-full object-cover transition-opacity duration-200",
                    isExtractingFrame && !cachedImageUrl ? "opacity-70" : "opacity-100"
                  )}
                />
                {/* Small loading indicator overlay when fetching new frame */}
                {isExtractingFrame && !cachedImageUrl && (
                  <div className="absolute top-3 left-3 bg-black/50 rounded-full p-1.5">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}
              </>
            ) : showSpinner ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                {/* Play button placeholder */}
                <div className="w-16 h-16 bg-gray-200/80 rounded-full flex items-center justify-center">
                  <Play className="w-8 h-8 text-gray-400 ml-1" />
                </div>
              </div>
            )}
            
            {/* Play/Pause button overlay when has frames */}
            {hasFrames && displayImageUrl && (
              <div 
                className="absolute inset-0 flex items-center justify-center"
                onClick={handlePlayPause}
              >
                <div className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center cursor-pointer transition-all",
                  isPlaying 
                    ? "bg-green-500/80 hover:bg-green-500/90" 
                    : "bg-black/40 hover:bg-black/50"
                )}>
                  {isPlaying ? (
                    <Pause className="w-8 h-8 text-white" />
                  ) : (
                    <Play className="w-8 h-8 text-white ml-1" />
                  )}
                </div>
              </div>
            )}
            
            {/* Current time / Duration badge */}
            <div className="absolute bottom-3 right-3 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">
              {hasFrames ? `${currentTimePosition} / ${totalDuration}` : '0:00'}
            </div>
            
            {/* App name badge */}
            {displayFrame?.app_name && (
              <div className="absolute top-3 right-3 bg-black/60 px-2 py-1 rounded text-xs text-white">
                {displayFrame.app_name}
              </div>
            )}
            
            {/* Pre-loading indicator */}
            {isPreloading && (
              <div className="absolute bottom-3 left-3 bg-black/60 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
                <div className="w-2 h-2 border border-white/50 border-t-white rounded-full animate-spin" />
                Caching...
              </div>
            )}
          </div>
        </div>
        
        {/* Waveform scrubber */}
        <div className="pt-4">
          <WaveformScrubber
            frames={extractableFrames}
            hoveredIndex={hoveredFrameIndex}
            onHoverIndex={setHoveredFrameIndex}
            selectedIndex={selectedFrameIndex}
            onSelectIndex={setSelectedFrameIndex}
            isPlaying={isPlaying}
          />
          
          {/* Time labels */}
          <div className="flex items-center justify-between mt-2 text-xs text-gray-400 font-mono">
            <span>{currentTimePosition}</span>
            <div className="flex items-center gap-1">
              <Volume2 className="w-3.5 h-3.5" />
              <span>{totalDuration}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScreenTimelineCard;
