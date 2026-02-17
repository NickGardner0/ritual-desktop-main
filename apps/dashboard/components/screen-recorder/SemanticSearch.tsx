'use client';

/**
 * Semantic Search Component
 * 
 * AI-powered search across screen recordings using vector embeddings.
 * Allows natural language queries like "When was I working on the API?" 
 * instead of exact keyword matches.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { format } from 'date-fns';
import { 
  Sparkles, 
  Search, 
  Clock, 
  FileText,
  Filter,
  ChevronDown,
  Loader2,
  AlertCircle,
  CheckCircle,
  Database,
  Cpu,
  Info,
  Play
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
// Note: Using simple state toggle instead of Collapsible component
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useRitualDatabase,
  useRitualDbStats,
  useEmbeddingService,
  useHybridSearch,
  useSemanticSearch,
  useTextSearch,
  useMigrationStatus,
  formatRelevance,
  getRelevanceColor,
  type HybridSearchResult,
  type SemanticSearchResult,
  type TextSearchResult,
} from '@/hooks/use-semantic-search';
import { formatTimestamp, type OcrFrame } from '@/hooks/use-recorder';

// ============================================================
// TYPES
// ============================================================

interface SemanticSearchProps {
  startTime?: Date;
  endTime?: Date;
  onFrameSelect?: (frame: OcrFrame) => void;
  className?: string;
}

type SearchMode = 'hybrid' | 'semantic' | 'text';

// ============================================================
// SUB-COMPONENTS
// ============================================================

function DatabaseStatus() {
  const { stats, isLoading } = useRitualDbStats();
  const { status: migrationStatus } = useMigrationStatus();

  if (isLoading || !stats) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Loading database status...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <Badge variant="outline" className="gap-1">
        <Database className="w-3 h-3" />
        {stats.db_size_mb.toFixed(1)} MB
      </Badge>
      <Badge variant="secondary" className="gap-1">
        {stats.ocr_frame_count} frames
      </Badge>
      <Badge variant="secondary" className="gap-1">
        {stats.embedding_count} embeddings
      </Badge>
      {migrationStatus?.is_fully_migrated && (
        <Badge variant="default" className="gap-1 bg-green-500/20 text-green-700 border-green-500/30">
          <CheckCircle className="w-3 h-3" />
          Migrated
        </Badge>
      )}
    </div>
  );
}

function EmbeddingStatus() {
  const { 
    isInitialized, 
    isInitializing, 
    stats, 
    error, 
    initialize,
    processEmbeddings,
  } = useEmbeddingService();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleProcessEmbeddings = async () => {
    setIsProcessing(true);
    try {
      await processEmbeddings(100);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isInitialized && !isInitializing && !error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
        <Info className="w-4 h-4 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm">Semantic search requires initialization</p>
          <p className="text-xs text-muted-foreground">
            This downloads the AI model for understanding your searches
          </p>
        </div>
        <Button size="sm" onClick={initialize} disabled={isInitializing}>
          {isInitializing ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Initializing...
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3 mr-1" />
              Enable AI Search
            </>
          )}
        </Button>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin" />
        <div className="flex-1">
          <p className="text-sm">Initializing AI model...</p>
          <p className="text-xs text-muted-foreground">
            This may take a moment on first run
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
        <AlertCircle className="w-4 h-4 text-destructive" />
        <div className="flex-1">
          <p className="text-sm text-destructive">Failed to initialize</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
        <Button size="sm" variant="outline" onClick={initialize}>
          Retry
        </Button>
      </div>
    );
  }

  if (!stats) return null;

  const embeddingProgress = stats.total_embeddings > 0 
    ? (stats.total_embeddings / (stats.total_embeddings + stats.frames_without_embeddings)) * 100
    : 0;

  return (
    <div className="border rounded-lg">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4" />
          <span className="text-sm">AI Model: {stats.current_model}</span>
        </div>
        <div className="flex items-center gap-2">
          {stats.frames_without_embeddings > 0 && (
            <Badge variant="secondary" className="text-xs">
              {stats.frames_without_embeddings} pending
            </Badge>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t">
          <div className="space-y-1 pt-3">
            <div className="flex justify-between text-xs">
              <span>Embeddings indexed</span>
              <span>{stats.total_embeddings} / {stats.total_embeddings + stats.frames_without_embeddings}</span>
            </div>
            <Progress value={embeddingProgress} className="h-2" />
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 bg-muted/50 rounded">
              <span className="text-muted-foreground">Dimension:</span>{' '}
              <span className="font-mono">{stats.embedding_dimension}</span>
            </div>
            <div className="p-2 bg-muted/50 rounded">
              <span className="text-muted-foreground">Pending:</span>{' '}
              <span className="font-mono">{stats.frames_without_embeddings}</span>
            </div>
          </div>

          {stats.frames_without_embeddings > 0 && (
            <Button 
              size="sm" 
              variant="secondary" 
              className="w-full"
              onClick={handleProcessEmbeddings}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 mr-1" />
                  Process {Math.min(100, stats.frames_without_embeddings)} embeddings
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SemanticResultItem({ 
  result, 
  onSelect 
}: { 
  result: SemanticSearchResult; 
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{result.app_name}</span>
            <Badge 
              variant={getRelevanceColor(result.relevance_score)}
              className="text-xs"
            >
              {formatRelevance(result.relevance_score)} match
            </Badge>
          </div>
          {result.window_title && (
            <p className="text-xs text-muted-foreground truncate mb-1">
              {result.window_title}
            </p>
          )}
          <p className="text-xs text-muted-foreground line-clamp-2">
            {result.ocr_text?.slice(0, 200)}...
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(result.timestamp)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function HybridResultItem({
  result,
  onSelect,
}: {
  result: HybridSearchResult;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{result.app_name}</span>
            <Badge variant={getRelevanceColor(result.combined_score)} className="text-xs">
              {formatRelevance(result.combined_score)} match
            </Badge>
            {result.fts_matched && (
              <Badge variant="outline" className="text-xs">
                FTS
              </Badge>
            )}
          </div>
          {result.window_title && (
            <p className="text-xs text-muted-foreground truncate mb-1">
              {result.window_title}
            </p>
          )}
          <p className="text-xs text-muted-foreground line-clamp-2">
            {result.ocr_text?.slice(0, 200)}...
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(result.timestamp)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function TextResultItem({ 
  result, 
  onSelect 
}: { 
  result: TextSearchResult; 
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{result.app_name}</span>
          </div>
          {result.window_title && (
            <p className="text-xs text-muted-foreground truncate mb-1">
              {result.window_title}
            </p>
          )}
          <p className="text-xs text-muted-foreground line-clamp-2">
            {result.ocr_text?.slice(0, 200)}...
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(result.timestamp)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function SemanticSearch({
  startTime,
  endTime,
  onFrameSelect,
  className,
}: SemanticSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('hybrid');
  const [showFilters, setShowFilters] = useState(false);

  // Database and embedding state
  const { isInitialized: dbInitialized, initialize: initDb } = useRitualDatabase();
  const { isInitialized: embeddingInitialized } = useEmbeddingService();

  // Search hooks
  const {
    results: hybridResults,
    isSearching: hybridSearching,
    search: hybridSearch,
    clearResults: clearHybridResults,
    error: hybridError,
  } = useHybridSearch();

  const { 
    results: semanticResults, 
    isSearching: semanticSearching, 
    search: semanticSearch,
    clearResults: clearSemanticResults,
    error: semanticError,
  } = useSemanticSearch();

  const {
    results: textResults,
    isSearching: textSearching,
    search: textSearch,
    clearResults: clearTextResults,
    error: textError,
  } = useTextSearch();

  const isSearching = searchMode === 'hybrid'
    ? hybridSearching
    : searchMode === 'semantic'
      ? semanticSearching
      : textSearching;
  const results = searchMode === 'hybrid'
    ? hybridResults
    : searchMode === 'semantic'
      ? semanticResults
      : textResults;
  const error = searchMode === 'hybrid'
    ? hybridError
    : searchMode === 'semantic'
      ? semanticError
      : textError;

  // Auto-initialize database
  useEffect(() => {
    if (!dbInitialized) {
      initDb();
    }
  }, [dbInitialized, initDb]);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    if (searchMode === 'hybrid') {
      await hybridSearch({
        query: searchQuery,
        limit: 20,
        min_relevance: 0.3,
        start_time: startTime?.getTime(),
        end_time: endTime?.getTime(),
      });
    } else if (searchMode === 'semantic') {
      await semanticSearch({
        query: searchQuery,
        limit: 20,
        min_relevance: 0.3,
        start_time: startTime?.getTime(),
        end_time: endTime?.getTime(),
      });
    } else {
      await textSearch(searchQuery, 50);
    }
  }, [searchQuery, searchMode, startTime, endTime, hybridSearch, semanticSearch, textSearch]);

  // Handle clear
  const handleClear = useCallback(() => {
    setSearchQuery('');
    clearHybridResults();
    clearSemanticResults();
    clearTextResults();
  }, [clearHybridResults, clearSemanticResults, clearTextResults]);

  // Convert result to OcrFrame format for parent component
  const handleResultSelect = useCallback((result: HybridSearchResult | SemanticSearchResult | TextSearchResult) => {
    const frame: OcrFrame = {
      id: result.frame_id,
      timestamp: result.timestamp,
      activity_event_id: null,
      app_bundle_id: result.app_bundle_id,
      app_name: result.app_name,
      window_title: result.window_title,
      ocr_text: result.ocr_text,
      ocr_confidence: 1.0,
      thumbnail_path: result.thumbnail_path,
      video_chunk_id: result.video_chunk_id,
      frame_offset: result.frame_offset,
    };
    onFrameSelect?.(frame);
  }, [onFrameSelect]);

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI-Powered Search
            </CardTitle>
            <CardDescription className="mt-1">
              Search your screen recordings using natural language
            </CardDescription>
          </div>
          <DatabaseStatus />
        </div>

        {/* Embedding status */}
        <div className="mt-3">
          <EmbeddingStatus />
        </div>

        {/* Search controls */}
        <div className="flex gap-2 mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={
                searchMode === 'text'
                  ? "Search for exact text..."
                  : searchMode === 'semantic'
                  ? "Ask a question like 'When was I reading about React hooks?'"
                  : "Ask a question like 'When did I debug the sync issue?'"
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>
          <Select value={searchMode} onValueChange={(v) => setSearchMode(v as SearchMode)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semantic">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  AI Search
                </div>
              </SelectItem>
              <SelectItem value="hybrid">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  Hybrid (Best)
                </div>
              </SelectItem>
              <SelectItem value="text">
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3" />
                  Text Search
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <Button 
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim() || ((searchMode === 'semantic' || searchMode === 'hybrid') && !embeddingInitialized)}
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Search'
            )}
          </Button>
          {results.length > 0 && (
            <Button variant="ghost" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>

        {/* Search mode explanation */}
        {(searchMode === 'semantic' || searchMode === 'hybrid') && !embeddingInitialized && (
          <p className="text-xs text-muted-foreground mt-2">
            AI search requires the embedding service to be initialized first.
          </p>
        )}
      </CardHeader>

      <CardContent>
        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {isSearching && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {/* Results */}
        {!isSearching && results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">
                {results.length} result{results.length !== 1 ? 's' : ''} found
              </p>
              {(searchMode === 'semantic' || searchMode === 'hybrid') && (
                <Badge variant="outline" className="text-xs">
                  Sorted by relevance
                </Badge>
              )}
            </div>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2 pr-4">
                {searchMode === 'hybrid'
                  ? (results as HybridSearchResult[]).map((result) => (
                      <HybridResultItem
                        key={result.frame_id}
                        result={result}
                        onSelect={() => handleResultSelect(result)}
                      />
                    ))
                  : searchMode === 'semantic'
                  ? (results as SemanticSearchResult[]).map((result) => (
                      <SemanticResultItem
                        key={result.frame_id}
                        result={result}
                        onSelect={() => handleResultSelect(result)}
                      />
                    ))
                  : (results as TextSearchResult[]).map((result) => (
                      <TextResultItem
                        key={result.frame_id}
                        result={result}
                        onSelect={() => handleResultSelect(result)}
                      />
                    ))
                }
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Empty state */}
        {!isSearching && results.length === 0 && searchQuery && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No results found</p>
            <p className="text-xs mt-1">
              Try different keywords or switch search modes
            </p>
          </div>
        )}

        {/* Initial state */}
        {!isSearching && results.length === 0 && !searchQuery && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="font-medium">Search your screen history</p>
            <p className="text-xs mt-1">
              {searchMode === 'semantic' 
                ? "Ask questions like 'What was I working on yesterday morning?'"
                : searchMode === 'hybrid'
                  ? "Hybrid search combines exact text and semantic understanding"
                  : "Search for exact text that appeared on screen"
              }
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SemanticSearch;
