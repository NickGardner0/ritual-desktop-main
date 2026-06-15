import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import {
  LEGACY_SCHEDULED_BLOCK_KEYS,
  LEGACY_SCHEDULED_BLOCK_KEY_PATTERN,
  LEGACY_SCHEDULED_BLOCK_MIGRATION_VERSION,
  extractLegacyArray,
  normalizeLegacyBlock,
  signatureFromApi,
  signatureFromPayload,
  type ScheduledBlockApi,
  type ScheduledBlockPayload,
} from './calendar-client.helpers';

export function useLegacyScheduledBlockMigration() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;
    if (typeof window === 'undefined') return;

    const migrationMarkerKey = `calendar-scheduled-blocks-migrated:${LEGACY_SCHEDULED_BLOCK_MIGRATION_VERSION}:${user.id}`;

    if (window.localStorage.getItem(migrationMarkerKey)) {
      return;
    }

    let isCancelled = false;

    const migrateLegacyScheduledBlocks = async () => {
      const legacyCandidates = new Set<string>(LEGACY_SCHEDULED_BLOCK_KEYS);
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (legacyCandidates.has(key) || LEGACY_SCHEDULED_BLOCK_KEY_PATTERN.test(key)) {
          legacyCandidates.add(key);
        }
      }

      const parsedBlocks: ScheduledBlockPayload[] = [];
      const consumedKeys: string[] = [];

      for (const key of legacyCandidates) {
        const rawValue = window.localStorage.getItem(key);
        if (!rawValue) continue;

        try {
          const parsedJson = JSON.parse(rawValue) as unknown;
          const legacyItems = extractLegacyArray(parsedJson);
          if (legacyItems.length === 0) continue;

          let foundAny = false;
          for (const legacyItem of legacyItems) {
            const normalized = normalizeLegacyBlock(legacyItem);
            if (!normalized) continue;
            parsedBlocks.push(normalized);
            foundAny = true;
          }

          if (foundAny) {
            consumedKeys.push(key);
          }
        } catch {
          // Ignore malformed legacy values and continue.
        }
      }

      if (parsedBlocks.length === 0) {
        window.localStorage.setItem(
          migrationMarkerKey,
          JSON.stringify({
            migratedAt: new Date().toISOString(),
            created: 0,
            skipped: 0,
            reason: 'no_legacy_blocks',
          })
        );
        return;
      }

      const token = await getToken();
      if (!token) return;

      const existingRes = await fetch('/api/calendar/scheduled-blocks', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!existingRes.ok) {
        throw new Error('Failed to fetch existing scheduled blocks before migration');
      }

      const existingBlocks = (await existingRes.json()) as ScheduledBlockApi[];
      const existingSignatures = new Set(existingBlocks.map(signatureFromApi));

      const dedupedLegacyBlocks = new Map<string, ScheduledBlockPayload>();
      for (const block of parsedBlocks) {
        const signature = signatureFromPayload(block);
        if (!dedupedLegacyBlocks.has(signature)) {
          dedupedLegacyBlocks.set(signature, block);
        }
      }

      let created = 0;
      let skipped = 0;
      let hasCreateFailure = false;

      for (const [signature, block] of dedupedLegacyBlocks) {
        if (existingSignatures.has(signature)) {
          skipped += 1;
          continue;
        }

        const createRes = await fetch('/api/calendar/scheduled-blocks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(block),
        });

        if (createRes.ok) {
          created += 1;
          existingSignatures.add(signature);
        } else {
          skipped += 1;
          hasCreateFailure = true;
        }
      }

      if (hasCreateFailure) {
        throw new Error('Some legacy scheduled blocks failed to migrate');
      }

      for (const key of consumedKeys) {
        window.localStorage.removeItem(key);
      }

      window.localStorage.setItem(
        migrationMarkerKey,
        JSON.stringify({
          migratedAt: new Date().toISOString(),
          created,
          skipped,
          sourceKeys: consumedKeys,
        })
      );

      if (!isCancelled) {
        await queryClient.invalidateQueries({
          queryKey: ['calendar-scheduled-blocks', user.id],
        });
        await queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.calendarReadModel.byUser(user.id),
        });
      }
    };

    migrateLegacyScheduledBlocks().catch((error) => {
      console.warn('Scheduled block migration skipped:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [getToken, queryClient, user?.id]);
}
