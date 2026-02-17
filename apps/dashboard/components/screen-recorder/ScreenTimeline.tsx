'use client';

/**
 * Screen Timeline Component
 * 
 * Displays a visual timeline of screen captures with thumbnails
 * and allows scrubbing through recorded content.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { 
  Search, 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronRight,
  Maximize2,
  Clock,
  FileText,
  Video,
  HardDrive
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useOcrFrames,
  useOcrSearch,
  useVideoChunks,
  type OcrFrame,
  type VideoChunk,
  formatTimestamp,
} from '@/hooks/use-recorder';

// ============================================================
// TYPES
// ============================================================

interface ScreenTimelineProps {
  startTime: Date;
  endTime: Date;
  onFrameSelect?: (frame: OcrFrame) => void;
  className?: string;
}

interface TimelineMarker {
  id: number;
  time: number;
  type: 'frame' | 'chunk';
  data: OcrFrame | VideoChunk;
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function ThumbnailPreview({ 
  frame, 
  isSelected,
  onClick 
}: { 
  frame: OcrFrame; 
  isSelected: boolean;
  onClick: () => void;
}) {
  const thumbnailUrl = frame.thumbnail_path 
    ? `file://${frame.thumbnail_path}`
    : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              'relative flex-shrink-0 w-24 h-14 rounded-md overflow-hidden border-2 transition-all',
              'hover:border-primary hover:scale-105',
              isSelected 
                ? 'border-primary ring-2 ring-primary/30' 
                : 'border-border'
            )}
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={`Screenshot at ${formatTimestamp(frame.timestamp)}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <Video className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            {frame.ocr_text && frame.ocr_text.length > 0 && (
              <div className="absolute bottom-0 right-0 p-0.5">
                <FileText className="w-3 h-3 text-primary" />
              </div>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{frame.app_name}</p>
            {frame.window_title && (
              <p className="text-xs text-muted-foreground truncate">
                {frame.window_title}
              </p>
            )}
            <p className="text-xs">{formatTimestamp(frame.timestamp)}</p>
            {frame.ocr_text && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {frame.ocr_text.slice(0, 100)}...
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TimelineRuler({ startTime, endTime }: { startTime: Date; endTime: Date }) {
  const hours = useMemo(() => {
    const result = [];
    const start = new Date(startTime);
    start.setMinutes(0, 0, 0);
    const end = new Date(endTime);
    
    while (start <= end) {
      result.push(new Date(start));
      start.setHours(start.getHours() + 1);
    }
    return result;
  }, [startTime, endTime]);

  const totalDuration = endTime.getTime() - startTime.getTime();

  return (
    <div className="relative h-6 bg-muted/30 border-y">
      {hours.map((hour) => {
        const position = ((hour.getTime() - startTime.getTime()) / totalDuration) * 100;
        if (position < 0 || position > 100) return null;
        
        return (
          <div
            key={hour.getTime()}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: `${position}%` }}
          >
            <div className="w-px h-2 bg-border" />
            <span className="text-[10px] text-muted-foreground">
              {format(hour, 'HH:mm')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FrameDetail({ frame }: { frame: OcrFrame }) {
  const thumbnailUrl = frame.thumbnail_path 
    ? `file://${frame.thumbnail_path}`
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="w-4 h-4" />
          {formatTimestamp(frame.timestamp)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Thumbnail */}
        {thumbnailUrl && (
          <div className="relative aspect-video bg-muted rounded-md overflow-hidden">
            <img
              src={thumbnailUrl}
              alt="Screenshot"
              className="w-full h-full object-contain"
            />
          </div>
        )}

        {/* App info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{frame.app_name}</Badge>
            <Badge variant="outline" className="text-xs">
              {(frame.ocr_confidence * 100).toFixed(0)}% OCR
            </Badge>
          </div>
          {frame.window_title && (
            <p className="text-sm text-muted-foreground truncate">
              {frame.window_title}
            </p>
          )}
        </div>

        {/* OCR text */}
        {frame.ocr_text && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase">
              Extracted Text
            </p>
            <ScrollArea className="h-32 rounded-md border p-2">
              <pre className="text-xs whitespace-pre-wrap font-mono">
                {frame.ocr_text}
              </pre>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SearchResults({ 
  results, 
  isLoading,
  onFrameSelect 
}: { 
  results: OcrFrame[];
  isLoading: boolean;
  onFrameSelect: (frame: OcrFrame) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No results found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.map((frame) => (
        <button
          key={frame.id}
          onClick={() => onFrameSelect(frame)}
          className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start gap-3">
            {frame.thumbnail_path && (
              <img
                src={`file://${frame.thumbnail_path}`}
                alt=""
                className="w-16 h-10 rounded object-cover flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">{frame.app_name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(frame.timestamp)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {frame.ocr_text?.slice(0, 150)}...
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function ScreenTimeline({
  startTime,
  endTime,
  onFrameSelect,
  className,
}: ScreenTimelineProps) {
  const [selectedFrame, setSelectedFrame] = useState<OcrFrame | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Fetch data
  const { frames, isLoading: framesLoading } = useOcrFrames(
    startTime.getTime(),
    endTime.getTime(),
    500
  );
  
  const { 
    results: searchResults, 
    isSearching, 
    search, 
    clearResults 
  } = useOcrSearch();

  const { chunks, isLoading: chunksLoading } = useVideoChunks(
    startTime.getTime(),
    endTime.getTime()
  );

  // Handle frame selection
  const handleFrameSelect = useCallback((frame: OcrFrame) => {
    setSelectedFrame(frame);
    onFrameSelect?.(frame);
  }, [onFrameSelect]);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      clearResults();
      setIsSearchMode(false);
      return;
    }
    setIsSearchMode(true);
    await search(searchQuery, {
      startTs: startTime.getTime(),
      endTs: endTime.getTime(),
      limit: 50,
    });
  }, [searchQuery, startTime, endTime, search, clearResults]);

  // Calculate timeline position for a timestamp
  const getTimelinePosition = useCallback((timestamp: number) => {
    const totalDuration = endTime.getTime() - startTime.getTime();
    return ((timestamp - startTime.getTime()) / totalDuration) * 100;
  }, [startTime, endTime]);

  // Render loading state
  if (framesLoading && frames.length === 0) {
    return (
      <Card className={cn('', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5" />
            Screen Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-6 w-full" />
            <div className="flex gap-2">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="w-24 h-14" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5" />
            Screen Timeline
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {frames.length} frames
            </Badge>
            <Badge variant="outline" className="text-xs">
              {chunks.length} chunks
            </Badge>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex gap-2 mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search screen content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button 
            variant="secondary" 
            onClick={handleSearch}
            disabled={isSearching}
          >
            Search
          </Button>
          {isSearchMode && (
            <Button 
              variant="ghost" 
              onClick={() => {
                setSearchQuery('');
                clearResults();
                setIsSearchMode(false);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Timeline ruler */}
        <TimelineRuler startTime={startTime} endTime={endTime} />

        {/* Timeline with thumbnails */}
        {!isSearchMode && (
          <>
            <ScrollArea className="w-full">
              <div 
                ref={timelineRef}
                className="flex gap-2 pb-2 min-w-max"
              >
                {frames.map((frame) => (
                  <ThumbnailPreview
                    key={frame.id}
                    frame={frame}
                    isSelected={selectedFrame?.id === frame.id}
                    onClick={() => handleFrameSelect(frame)}
                  />
                ))}
                {frames.length === 0 && (
                  <div className="flex items-center justify-center w-full h-14 text-muted-foreground">
                    <p className="text-sm">No screen captures for this time range</p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Video chunks visualization */}
            <div className="relative h-4 bg-muted/30 rounded">
              {chunks.map((chunk) => {
                const startPos = getTimelinePosition(chunk.start_time);
                const endPos = chunk.end_time 
                  ? getTimelinePosition(chunk.end_time)
                  : getTimelinePosition(endTime.getTime());
                const width = endPos - startPos;

                return (
                  <TooltipProvider key={chunk.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'absolute h-full rounded',
                            chunk.storage_tier === 'hot' && 'bg-green-500/40',
                            chunk.storage_tier === 'warm' && 'bg-yellow-500/40',
                            chunk.storage_tier === 'cold' && 'bg-blue-500/40'
                          )}
                          style={{
                            left: `${Math.max(0, startPos)}%`,
                            width: `${Math.min(100 - startPos, width)}%`,
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">{chunk.file_path.split('/').pop()}</p>
                        <p className="text-xs text-muted-foreground">
                          {chunk.frame_count} frames • {chunk.storage_tier} tier
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </>
        )}

        {/* Search results */}
        {isSearchMode && (
          <ScrollArea className="h-64">
            <SearchResults
              results={searchResults?.frames ?? []}
              isLoading={isSearching}
              onFrameSelect={handleFrameSelect}
            />
          </ScrollArea>
        )}

        {/* Selected frame detail */}
        {selectedFrame && (
          <div className="border-t pt-4">
            <FrameDetail frame={selectedFrame} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ScreenTimeline;
