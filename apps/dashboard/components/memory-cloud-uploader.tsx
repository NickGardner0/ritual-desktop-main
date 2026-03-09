'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import { isTauri } from '@/lib/tauri-utils';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const MEMORY_CLOUD_ENABLED_ENV = (() => {
  const raw = (process.env.NEXT_PUBLIC_RITUAL_MEMORY_CLOUD_ENABLED ?? '').trim().toLowerCase();
  if (!raw) {
    // Evaluate desktop runtime at call time (not module-load time) because
    // Tauri globals may not be attached yet during early client bootstrap.
    return null;
  }
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();
const UPLOADER_ENABLED = (() => {
  const raw = (process.env.NEXT_PUBLIC_RITUAL_MEMORY_CLOUD_UPLOADER ?? 'true').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();

const START_DELAY_MS = 2_500;
const IDLE_INTERVAL_MS = 8_000;
const BUSY_INTERVAL_MS = 1_500;
const ERROR_INTERVAL_MS = 10_000;
const CLAIM_BATCH_LIMIT = 256;
const SEED_SCAN_LIMIT = 600;

type MemoryUploadOutboxItem = {
  id: number;
  user_id: string;
  device_id: string;
  chunk_id: number;
  logical_chunk_id?: string | null;
  content_hash?: string | null;
  payload_json: string;
  retry_count: number;
};

type MemoryUploadOutboxSeedResult = {
  inserted: number;
  scanned_limit: number;
};

type MemoryIngestChunk = {
  chunk_id: string;
  logical_chunk_id?: string;
  chunk_start_ts: number;
  chunk_end_ts: number;
  app_name?: string;
  window_title?: string;
  browser_domain?: string;
  text_compact?: string;
  quality_score?: number;
  source_frame_ids?: number[];
  content_hash?: string;
};

type MemoryIngestResponse = {
  success: boolean;
  accepted: number;
  deduped: number;
  failed: number;
  accepted_count?: number;
  deduped_count?: number;
  failed_count?: number;
  superseded_count?: number;
  provider_delete_queued?: number;
  retry_after_seconds: number;
  warning?: string | null;
  error?: string | null;
};

function normalizeChunkPayload(raw: unknown): MemoryIngestChunk | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const chunkId = String(value.chunk_id ?? '').trim();
  const startTs = Number(value.chunk_start_ts ?? 0);
  const endTs = Number(value.chunk_end_ts ?? 0);
  if (!chunkId || !Number.isFinite(startTs) || !Number.isFinite(endTs) || startTs <= 0 || endTs <= 0) {
    return null;
  }
  const sourceFrameIds = Array.isArray(value.source_frame_ids)
    ? value.source_frame_ids
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, 400)
    : [];
  const qualityScoreRaw = Number(value.quality_score ?? 0);
  const qualityScore = Number.isFinite(qualityScoreRaw)
    ? Math.max(0, Math.min(1, qualityScoreRaw))
    : 0;

  return {
    chunk_id: chunkId,
    logical_chunk_id: String(value.logical_chunk_id ?? chunkId),
    chunk_start_ts: Math.trunc(startTs),
    chunk_end_ts: Math.trunc(endTs),
    app_name: String(value.app_name ?? ''),
    window_title: String(value.window_title ?? ''),
    browser_domain: String(value.browser_domain ?? ''),
    text_compact: String(value.text_compact ?? ''),
    quality_score: qualityScore,
    source_frame_ids: sourceFrameIds,
    content_hash: value.content_hash ? String(value.content_hash) : undefined,
  };
}

function groupByDevice(items: MemoryUploadOutboxItem[]): Map<string, MemoryUploadOutboxItem[]> {
  const grouped = new Map<string, MemoryUploadOutboxItem[]>();
  for (const item of items) {
    const key = (item.device_id || 'local-device').trim() || 'local-device';
    const existing = grouped.get(key);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}

export function MemoryCloudUploader() {
  const { getToken, isLoaded, userId } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const runningRef = useRef(false);
  const disabledUntilRef = useRef(0);
  const memoryCloudEnabledRef = useRef(false);

  const isMemoryCloudEnabled = () => {
    if (MEMORY_CLOUD_ENABLED_ENV === null) {
      return isTauri();
    }
    return MEMORY_CLOUD_ENABLED_ENV;
  };

  useEffect(() => {
    if (!UPLOADER_ENABLED) {
      return;
    }

    const scheduleNext = (delayMs: number) => {
      if (stoppedRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void runCycle();
      }, delayMs);
    };

    const ackBatch = async (ids: number[], success: boolean, errorMessage?: string) => {
      if (ids.length === 0) return;
      const { invoke } = await import('@tauri-apps/api/tauri');
      const invokeWithDbInitRetry = async <T,>(command: string, args?: Record<string, unknown>) => {
        try {
          return await invoke<T>(command, args);
        } catch (error) {
          const message = String((error as { message?: unknown })?.message ?? error ?? '').toLowerCase();
          const needsDbInit =
            command !== 'init_ritual_database' &&
            message.includes('database not initialized') &&
            message.includes('initialize_database');
          if (!needsDbInit) throw error;
          await invoke<string>('init_ritual_database');
          return await invoke<T>(command, args);
        }
      };

      await invokeWithDbInitRetry('ack_memory_upload_outbox_batch', {
        ids,
        success,
        errorMessage: errorMessage ?? null,
      });
    };

    const runCycle = async () => {
      if (stoppedRef.current || runningRef.current) return;
      runningRef.current = true;

      try {
        memoryCloudEnabledRef.current = isMemoryCloudEnabled();
        if (!memoryCloudEnabledRef.current || !isTauri() || !isLoaded || !userId) {
          scheduleNext(IDLE_INTERVAL_MS);
          return;
        }

        if (Date.now() < disabledUntilRef.current) {
          scheduleNext(IDLE_INTERVAL_MS);
          return;
        }

        const token = await getToken();
        if (!token) {
          scheduleNext(IDLE_INTERVAL_MS);
          return;
        }

        const { invoke } = await import('@tauri-apps/api/tauri');
        const invokeWithDbInitRetry = async <T,>(command: string, args?: Record<string, unknown>) => {
          try {
            return await invoke<T>(command, args);
          } catch (error) {
            const message = String((error as { message?: unknown })?.message ?? error ?? '').toLowerCase();
            const needsDbInit =
              command !== 'init_ritual_database' &&
              message.includes('database not initialized') &&
              message.includes('initialize_database');
            if (!needsDbInit) throw error;
            await invoke<string>('init_ritual_database');
            return await invoke<T>(command, args);
          }
        };

        let seeded = 0;
        try {
          const seedResult = await invokeWithDbInitRetry<MemoryUploadOutboxSeedResult>('seed_memory_upload_outbox', {
            limit: SEED_SCAN_LIMIT,
          });
          seeded = Number(seedResult?.inserted || 0);
        } catch (error) {
          console.warn('Memory cloud uploader: seed outbox failed', error);
        }

        const claimed = await invokeWithDbInitRetry<MemoryUploadOutboxItem[]>('claim_memory_upload_outbox_batch', {
          limit: CLAIM_BATCH_LIMIT,
        });
        if (!claimed || claimed.length === 0) {
          scheduleNext(seeded > 0 ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS);
          return;
        }

        const groupedByDevice = groupByDevice(claimed);
        let hadFailure = false;
        let uploadedCount = 0;

        for (const [deviceId, rows] of groupedByDevice.entries()) {
          const parsable: { id: number; chunk: MemoryIngestChunk }[] = [];
          const invalidIds: number[] = [];

          for (const row of rows) {
            try {
              const parsed = JSON.parse(row.payload_json);
              const normalized = normalizeChunkPayload(parsed);
              if (!normalized) {
                invalidIds.push(row.id);
                continue;
              }
              parsable.push({ id: row.id, chunk: normalized });
            } catch {
              invalidIds.push(row.id);
            }
          }

          if (invalidIds.length > 0) {
            hadFailure = true;
            await ackBatch(invalidIds, false, 'invalid outbox payload');
          }

          if (parsable.length === 0) {
            continue;
          }

          const requestBody = {
            device_id: deviceId,
            chunks: parsable.map((entry) => entry.chunk),
          };

          try {
            const response = await fetch(`${PYTHON_API_BASE}/api/memory/ingest-chunks`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
              const errorText = await response.text();
              const message = `ingest HTTP ${response.status}: ${errorText}`;
              await ackBatch(parsable.map((entry) => entry.id), false, message.slice(0, 1000));
              hadFailure = true;
              if (response.status === 503) {
                // Cloud memory disabled/unavailable: stop uploader for this session.
                disabledUntilRef.current = Date.now() + (24 * 60 * 60 * 1000);
              }
              continue;
            }

            const result = await response.json() as MemoryIngestResponse;
            const acceptedCount = Number(result.accepted_count ?? result.accepted ?? 0);
            const dedupedCount = Number(result.deduped_count ?? result.deduped ?? 0);
            const failedCount = Number(result.failed_count ?? result.failed ?? 0);
            const supersededCount = Number(result.superseded_count ?? 0);
            const providerDeleteQueued = Number(result.provider_delete_queued ?? 0);
            if (supersededCount > 0 || providerDeleteQueued > 0) {
              console.info(
                'Memory cloud uploader: superseded=%d provider_delete_queued=%d',
                supersededCount,
                providerDeleteQueued,
              );
            }

            if (Boolean(result.success) && failedCount === 0) {
              await ackBatch(parsable.map((entry) => entry.id), true);
              uploadedCount += parsable.length;
            } else if ((acceptedCount + dedupedCount) === 0) {
              await ackBatch(
                parsable.map((entry) => entry.id),
                false,
                result.error || result.warning || 'ingest failed',
              );
              hadFailure = true;
            } else {
              // Partial success: isolate accepted/deduped rows so we don't retry good rows.
              const successfulIds: number[] = [];
              const failedIds: number[] = [];
              for (const entry of parsable) {
                try {
                  const singleResp = await fetch(`${PYTHON_API_BASE}/api/memory/ingest-chunks`, {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      device_id: deviceId,
                      chunks: [entry.chunk],
                    }),
                  });
                  if (!singleResp.ok) {
                    failedIds.push(entry.id);
                    continue;
                  }
                  const single = await singleResp.json() as MemoryIngestResponse;
                  const singleFailed = Number(single.failed_count ?? single.failed ?? 0);
                  if (Boolean(single.success) && singleFailed === 0) {
                    successfulIds.push(entry.id);
                  } else {
                    failedIds.push(entry.id);
                  }
                } catch {
                  failedIds.push(entry.id);
                }
              }

              if (successfulIds.length > 0) {
                await ackBatch(successfulIds, true);
                uploadedCount += successfulIds.length;
              }
              if (failedIds.length > 0) {
                await ackBatch(failedIds, false, result.error || result.warning || 'partial ingest failed');
                hadFailure = true;
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ackBatch(parsable.map((entry) => entry.id), false, message.slice(0, 1000));
            hadFailure = true;
          }
        }

        if (hadFailure) {
          scheduleNext(ERROR_INTERVAL_MS);
        } else {
          scheduleNext(uploadedCount > 0 || seeded > 0 ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS);
        }
      } catch (error) {
        console.warn('Memory cloud uploader cycle failed:', error);
        scheduleNext(ERROR_INTERVAL_MS);
      } finally {
        runningRef.current = false;
      }
    };

    stoppedRef.current = false;
    scheduleNext(START_DELAY_MS);

    return () => {
      stoppedRef.current = true;
      runningRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [getToken, isLoaded, userId]);

  return null;
}
