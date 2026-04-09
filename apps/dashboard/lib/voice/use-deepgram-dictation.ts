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
  keyterms?: string[];
  onAudioStreamChange?: (stream: MediaStream | null) => void;
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

async function fetchDeepgramToken(): Promise<string> {
  const response = await fetch('/api/deepgram/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Deepgram token request failed');
  }

  const payload = await response.json();
  if (!payload?.token) {
    throw new Error('Deepgram token response missing token');
  }

  return payload.token as string;
}

export function useDeepgramDictation(options: DeepgramDictationOptions) {
  const optionsRef = useRef(options);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const manualStopRef = useRef(false);
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

  const cleanup = useCallback(
    async ({ suppressError = true }: { suppressError?: boolean } = {}) => {
      activeRef.current = false;
      manualStopRef.current = false;
      clearTimer();

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
      sourceNodeRef.current = null;
      gainNodeRef.current = null;
      audioContextRef.current = null;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      segmentBufferRef.current = [];
      interimRef.current = '';
      optionsRef.current.onInterimTranscriptChange?.(null);
      optionsRef.current.onAudioStreamChange?.(null);
      optionsRef.current.onListeningChange?.(false);
      optionsRef.current.onProcessingChange?.(false);
    },
    [clearTimer],
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
    commitBufferedTranscript();
    await cleanup();
  }, [cleanup, commitBufferedTranscript]);

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

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    gainNodeRef.current = gainNode;

    const sendPcmChunk = (chunk: Int16Array) => {
      const ws = wsRef.current;
      if (!chunk.length || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(chunk.buffer.slice(0));
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
    lastCommittedRef.current = '';
    optionsRef.current.onError?.(null);
    optionsRef.current.onProcessingChange?.(true);
    optionsRef.current.onInterimTranscriptChange?.(null);
    segmentBufferRef.current = [];
    interimRef.current = '';

    const token = await fetchDeepgramToken();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    streamRef.current = stream;
    optionsRef.current.onAudioStreamChange?.(stream);

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
        resolve();
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Deepgram connection failed'));
      };
    });

    try {
      await connectAudioPipeline(stream);
    } catch (error) {
      await cleanup();
      throw error;
    }

    activeRef.current = true;
    optionsRef.current.onListeningChange?.(true);
    optionsRef.current.onProcessingChange?.(false);

    ws.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as DeepgramListenResult;

      if (payload.type === 'SpeechStarted') {
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
      } else {
        interimRef.current = transcript;
        emitInterim();
      }

      if (payload.speech_final) {
        void finalizeAndStop();
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
  }, [cleanup, clearTimer, connectAudioPipeline, emitInterim, finalizeAndStop, isSupported, stop]);

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
