import { useCallback, useEffect, useMemo, useRef } from 'react';

type DeepgramDictationOptions = {
  language?: string;
  model?: string;
  punctuate?: boolean;
  smartFormat?: boolean;
  numerals?: boolean;
  endpointingMs?: number;
  utteranceEndMs?: number;
  maxDurationMs?: number;
  /** Auto-commit after is_final stability (ms). 0 = wait for UtteranceEnd. */
  commitStabilityMs?: number;
  keyterms?: string[];
  onAudioStreamChange?: (stream: MediaStream | null) => void;
  onAnalyserNode?: (node: AnalyserNode | null) => void;
  onListeningChange?: (listening: boolean) => void;
  onProcessingChange?: (processing: boolean) => void;
  onInterimTranscriptChange?: (text: string | null) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (message: string | null) => void;
};

type DeepgramListenResult = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
};

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function downsampleChunk(
  chunk: Float32Array,
  sourceRate: number,
  targetRate: number,
  state: { carry: Float32Array; position: number },
): Int16Array {
  const merged = new Float32Array(state.carry.length + chunk.length);
  merged.set(state.carry, 0);
  merged.set(chunk, state.carry.length);

  const ratio = sourceRate / targetRate;
  const samples: number[] = [];
  let position = state.position;

  while (position + ratio <= merged.length) {
    const start = Math.floor(position);
    const end = Math.max(start + 1, Math.floor(position + ratio));
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += 1) {
      sum += merged[i] ?? 0;
      count += 1;
    }
    samples.push(floatToInt16(count > 0 ? sum / count : 0));
    position += ratio;
  }

  const consumed = Math.floor(position);
  state.carry = consumed > 0 ? merged.slice(consumed) : merged;
  state.position = position - consumed;

  return Int16Array.from(samples);
}

// ---------------------------------------------------------------------------
// Token cache — avoids 200-800ms round-trip on every voice session.
// Token TTL is 120s; we refresh with a 15s safety margin.
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;
let tokenFetchPromise: Promise<string> | null = null;

async function fetchDeepgramToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  // Deduplicate concurrent fetches
  if (tokenFetchPromise) return tokenFetchPromise;

  tokenFetchPromise = (async () => {
    try {
      const response = await fetch('/api/deepgram/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Deepgram token request failed');
      }

      const payload = await response.json();
      if (!payload?.token) {
        throw new Error('Deepgram token response missing token');
      }

      cachedToken = payload.token as string;
      const ttl = (payload.expiresIn ?? 120) as number;
      // Refresh 15s before expiry to avoid using a stale token
      cachedTokenExpiry = Date.now() + (ttl - 15) * 1000;
      return cachedToken;
    } finally {
      tokenFetchPromise = null;
    }
  })();

  return tokenFetchPromise;
}

/** Pre-warm the token cache. Call on mic button hover or component mount. */
export function prefetchDeepgramToken(): void {
  fetchDeepgramToken().catch(() => {});
}

export function useDeepgramDictation(options: DeepgramDictationOptions) {
  const optionsRef = useRef(options);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const manualStopRef = useRef(false);
  const queuedChunksRef = useRef<ArrayBuffer[]>([]);
  const sessionCounterRef = useRef(0);
  const sessionIdRef = useRef(0);
  const segmentBufferRef = useRef<string[]>([]);
  const interimRef = useRef('');
  const lastCommittedRef = useRef('');

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const emitInterim = useCallback(() => {
    const merged = normalizeSpaces(
      [...segmentBufferRef.current, interimRef.current].filter(Boolean).join(' '),
    );
    optionsRef.current.onInterimTranscriptChange?.(merged || null);
  }, []);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(
    async ({ suppressError = true }: { suppressError?: boolean } = {}) => {
      activeRef.current = false;
      manualStopRef.current = false;
      sessionIdRef.current = 0;
      clearTimer();
      clearCommitTimer();
      queuedChunksRef.current = [];
      segmentBufferRef.current = [];
      interimRef.current = '';
      optionsRef.current.onInterimTranscriptChange?.(null);
      optionsRef.current.onAudioStreamChange?.(null);
      optionsRef.current.onAnalyserNode?.(null);
      optionsRef.current.onListeningChange?.(false);
      optionsRef.current.onProcessingChange?.(false);

      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          if (!suppressError) {
            optionsRef.current.onError?.('Failed to close Deepgram connection.');
          }
        }
      }

      try {
        audioNodeRef.current?.disconnect();
      } catch {}
      try {
        analyserNodeRef.current?.disconnect();
      } catch {}
      try {
        sourceNodeRef.current?.disconnect();
      } catch {}
      try {
        gainNodeRef.current?.disconnect();
      } catch {}
      try {
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close();
        }
      } catch {}

      audioNodeRef.current = null;
      analyserNodeRef.current = null;
      sourceNodeRef.current = null;
      gainNodeRef.current = null;
      audioContextRef.current = null;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    },
    [clearTimer, clearCommitTimer],
  );

  const commitBufferedTranscript = useCallback(() => {
    const current = normalizeSpaces(
      [...segmentBufferRef.current, interimRef.current].filter(Boolean).join(' '),
    );
    if (!current || current === lastCommittedRef.current) {
      return;
    }
    lastCommittedRef.current = current;
    optionsRef.current.onFinalTranscript?.(current);
  }, []);

  const finalizeAndStop = useCallback(async () => {
    clearCommitTimer();
    commitBufferedTranscript();
    await cleanup();
  }, [cleanup, clearCommitTimer, commitBufferedTranscript]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    manualStopRef.current = true;
    void finalizeAndStop();
  }, [finalizeAndStop]);

  const isSupported = useMemo(() => {
    return (
      typeof window !== 'undefined' &&
      typeof WebSocket !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  const connectAudioPipeline = useCallback(async (stream: MediaStream) => {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    // Single AnalyserNode shared with the waveform visualizer — eliminates
    // the second AudioContext that VoiceWaveform used to create on its own.
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.22;
    analyserNodeRef.current = analyser;
    source.connect(analyser);
    optionsRef.current.onAnalyserNode?.(analyser);

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    gainNodeRef.current = gainNode;

    const sendPcmChunk = (chunk: Int16Array) => {
      if (!chunk.length) return;
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      const buffer = copy.buffer;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
        return;
      }
      queuedChunksRef.current.push(buffer);
      if (queuedChunksRef.current.length > 128) {
        queuedChunksRef.current.splice(0, queuedChunksRef.current.length - 128);
      }
    };

    if (audioContext.audioWorklet) {
      await audioContext.audioWorklet.addModule('/worklets/deepgram-pcm-processor.js');
      const workletNode = new AudioWorkletNode(audioContext, 'deepgram-pcm-processor', {
        processorOptions: {
          targetSampleRate: 16000,
        },
      });
      workletNode.port.onmessage = (event: MessageEvent<{ type: string; buffer?: ArrayBuffer }>) => {
        if (event.data?.type !== 'audio' || !event.data.buffer) return;
        sendPcmChunk(new Int16Array(event.data.buffer));
      };
      audioNodeRef.current = workletNode;
      source.connect(workletNode);
      workletNode.connect(gainNode);
      gainNode.connect(audioContext.destination);
      return;
    }

    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const downsampleState = {
      carry: new Float32Array(0),
      position: 0,
    };
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = downsampleChunk(input, audioContext.sampleRate, 16000, downsampleState);
      sendPcmChunk(pcm);
    };
    audioNodeRef.current = processor;
    source.connect(processor);
    processor.connect(gainNode);
    gainNode.connect(audioContext.destination);
  }, []);

  const start = useCallback(async () => {
    if (!isSupported) {
      throw new Error('Deepgram streaming is not supported in this environment');
    }

    await cleanup();
    const sessionId = ++sessionCounterRef.current;
    sessionIdRef.current = sessionId;
    lastCommittedRef.current = '';
    optionsRef.current.onError?.(null);
    optionsRef.current.onProcessingChange?.(true);
    optionsRef.current.onInterimTranscriptChange?.(null);
    segmentBufferRef.current = [];
    interimRef.current = '';

    // Kick off token fetch in parallel with getUserMedia + audio pipeline.
    // This overlaps the ~200-800ms token round-trip with the ~100-500ms
    // mic permission + AudioContext setup, eliminating the serial waterfall.
    const tokenPromise = fetchDeepgramToken();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (sessionIdRef.current !== sessionId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    try {
      await connectAudioPipeline(stream);
    } catch (error) {
      await cleanup();
      throw error;
    }
    if (sessionIdRef.current !== sessionId) {
      await cleanup();
      return;
    }

    // Emit stream + listening state together so the waveform effect sees
    // both on the same React render — fixes the first-click race condition
    // where audioStream arrived before isActive.
    optionsRef.current.onAudioStreamChange?.(stream);
    activeRef.current = true;
    optionsRef.current.onListeningChange?.(true);
    optionsRef.current.onProcessingChange?.(false);

    let token: string;
    try {
      token = await tokenPromise;
    } catch (error) {
      await cleanup();
      throw error;
    }
    if (sessionIdRef.current !== sessionId) {
      await cleanup();
      return;
    }

    const url = new URL('wss://api.deepgram.com/v1/listen');
    url.searchParams.set('model', optionsRef.current.model || 'nova-3');
    url.searchParams.set('language', optionsRef.current.language || 'en-US');
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', '16000');
    url.searchParams.set('channels', '1');
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('vad_events', 'true');
    url.searchParams.set('numerals', optionsRef.current.numerals === false ? 'false' : 'true');
    url.searchParams.set('punctuate', optionsRef.current.punctuate ? 'true' : 'false');
    url.searchParams.set('smart_format', optionsRef.current.smartFormat ? 'true' : 'false');
    url.searchParams.set(
      'endpointing',
      String(optionsRef.current.endpointingMs ?? 350),
    );
    url.searchParams.set(
      'utterance_end_ms',
      String(optionsRef.current.utteranceEndMs ?? 1000),
    );
    for (const keyterm of optionsRef.current.keyterms || []) {
      if (keyterm.trim()) {
        url.searchParams.append('keyterm', keyterm.trim());
      }
    }

    const ws = new WebSocket(url.toString(), ['token', token]);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Deepgram connection timed out'));
      }, 8000);

      ws.onopen = () => {
        window.clearTimeout(timeout);
        const queued = queuedChunksRef.current.splice(0);
        for (const chunk of queued) {
          if (ws.readyState !== WebSocket.OPEN) break;
          ws.send(chunk);
        }
        resolve();
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Deepgram connection failed'));
      };

      ws.onclose = () => {
        window.clearTimeout(timeout);
        reject(new Error('Deepgram connection closed before ready'));
      };
    });

    const commitStabilityMs = optionsRef.current.commitStabilityMs ?? 0;

    ws.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as DeepgramListenResult;

      if (payload.type === 'SpeechStarted') {
        // New speech resets the commit stability timer — user is still talking
        clearCommitTimer();
        return;
      }

      if (payload.type === 'UtteranceEnd') {
        void finalizeAndStop();
        return;
      }

      if (payload.type !== 'Results') {
        return;
      }

      const transcript = normalizeSpaces(
        payload.channel?.alternatives?.[0]?.transcript || '',
      );
      if (!transcript) return;

      if (payload.is_final) {
        const last = segmentBufferRef.current[segmentBufferRef.current.length - 1];
        if (transcript !== last) {
          segmentBufferRef.current.push(transcript);
        }
        interimRef.current = '';
        emitInterim();

        // Auto-commit: if no new is_final arrives within commitStabilityMs,
        // commit immediately instead of waiting for UtteranceEnd (~1-2s more).
        // For short habit-logging utterances this cuts perceived latency in half.
        if (commitStabilityMs > 0) {
          clearCommitTimer();
          commitTimerRef.current = window.setTimeout(() => {
            void finalizeAndStop();
          }, commitStabilityMs);
        }
      } else {
        interimRef.current = transcript;
        emitInterim();

        // Interim speech resets commit timer — user is still talking
        if (commitStabilityMs > 0) {
          clearCommitTimer();
        }
      }

    };

    ws.onclose = () => {
      if (!activeRef.current && !manualStopRef.current) return;
      if (manualStopRef.current) {
        void cleanup();
        return;
      }
      void finalizeAndStop();
    };

    ws.onerror = () => {
      optionsRef.current.onError?.('Deepgram streaming failed. Falling back to local voice.');
      void cleanup();
    };

    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      stop();
    }, optionsRef.current.maxDurationMs ?? 15000);
  }, [cleanup, clearTimer, clearCommitTimer, connectAudioPipeline, emitInterim, finalizeAndStop, isSupported, stop]);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  return {
    cleanup,
    isSupported,
    start,
    stop,
  };
}
