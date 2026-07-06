'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useUser } from '@clerk/nextjs';
import { Database, ShieldCheck, Trash2 } from 'lucide-react';
import type { CloudConsent, PrivacyMode } from '@ritual/shared-contracts';
import {
  DEFAULT_PRIVACY_SETTINGS,
  privacySettingsHeaders,
  readPrivacySettings,
  writePrivacySettings,
  type PrivacySettings,
} from '@/lib/privacy/privacy-settings';
import {
  vaultSync,
  type DesktopVaultStatus,
} from '@/lib/privacy/vault-sync';
import {
  executeLocalVaultMigration,
  LOCAL_MIGRATION_CATEGORY_LABELS,
  SUPPORTED_LOCAL_MIGRATION_CATEGORIES,
  type LocalVaultMigrationResult,
  type SupportedLocalMigrationCategory,
} from '@/lib/privacy/vault-migration';
import {
  CLOUD_DELETION_CATEGORY_LABELS,
  SUPPORTED_CLOUD_DELETION_CATEGORIES,
  executeCloudBehavioralDeletion,
  type CloudDeletionResult,
  type DeletionPlan,
  type SupportedCloudDeletionCategory,
} from '@/lib/privacy/vault-deletion';
import {
  SettingsGroup,
  SettingsRow,
} from '@/components/ui/ritual-system';
import { PrivacyExternalErasureSection } from '@/components/privacy-external-erasure-section';
import { PrivacyPrivateSyncSection } from '@/components/privacy-private-sync-section';
import { PrivacyVaultExportSection } from '@/components/privacy-vault-export-section';
import { cn } from '@/lib/utils';

const MODE_OPTIONS: Array<{ value: PrivacyMode; label: string; detail: string }> = [
  {
    value: 'local_only',
    label: 'Local Only',
    detail: 'Sensitive data stays on this device unless a separate consent is enabled.',
  },
  {
    value: 'private_sync',
    label: 'Private Sync',
    detail: 'Only encrypted vault envelopes are eligible for sync.',
  },
  {
    value: 'cloud_intelligence',
    label: 'Cloud Intelligence',
    detail: 'Cloud AI, analytics, and providers require the specific consents below.',
  },
];

const CONSENT_OPTIONS: Array<{ key: CloudConsent; label: string; detail: string }> = [
  { key: 'product_telemetry', label: 'Product telemetry', detail: 'Enables redacted usage events.' },
  { key: 'crash_diagnostics', label: 'Crash diagnostics', detail: 'Enables minimal error diagnostics.' },
  { key: 'analytics', label: 'Cloud analytics', detail: 'Allows Tinybird analytics writes and reads.' },
  { key: 'search', label: 'Cloud search', detail: 'Allows Typesense indexing and search.' },
  { key: 'ai', label: 'AI chat', detail: 'Allows cloud model calls for chat.' },
  { key: 'voice', label: 'Voice transcription', detail: 'Allows Deepgram, Groq, or Whisper calls.' },
  { key: 'vision', label: 'Screenshot analysis', detail: 'Allows image analysis for imports and logs.' },
  { key: 'provider_sync', label: 'Provider sync', detail: 'Allows scheduled wearable, finance, and integration sync.' },
  { key: 'sms', label: 'SMS assistant', detail: 'Allows SMS delivery and proactive assistant paths.' },
  { key: 'plaintext_sync', label: 'Legacy plaintext sync', detail: 'Allows legacy non-E2EE sync paths while migrating.' },
];

function subscribeToPrivacySettings(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handleChange = () => onStoreChange();
  window.addEventListener('storage', handleChange);
  window.addEventListener('ritual:privacy-settings-changed', handleChange);
  return () => {
    window.removeEventListener('storage', handleChange);
    window.removeEventListener('ritual:privacy-settings-changed', handleChange);
  };
}

type MigrationInventoryCategory = {
  source: string;
  category: string;
  description: string;
  record_count: number;
  status: string;
  checked_at: string;
};

type MigrationInventory = {
  checked_at: string;
  deletes_cloud_data: boolean;
  total_records: number;
  categories: MigrationInventoryCategory[];
};

type MigrationDryRunSample = {
  collection: string;
  record_id: string;
  record_type: string;
  updated_at?: string | null;
  payload: unknown;
};

type MigrationDryRun = {
  deletes_cloud_data: boolean;
  changes_source_of_truth: boolean;
  sample_count: number;
  sample_hash: string;
  samples: MigrationDryRunSample[];
};

export function PrivacySettingsPanel() {
  const { user } = useUser();
  const settings = useSyncExternalStore(
    subscribeToPrivacySettings,
    readPrivacySettings,
    () => DEFAULT_PRIVACY_SETTINGS,
  );
  const [vaultStatus, setVaultStatus] = useState<DesktopVaultStatus | null>(null);
  const [inventory, setInventory] = useState<MigrationInventory | null>(null);
  const [dryRun, setDryRun] = useState<MigrationDryRun | null>(null);
  const [selectedMigrationCategories, setSelectedMigrationCategories] = useState<SupportedLocalMigrationCategory[]>([
    ...SUPPORTED_LOCAL_MIGRATION_CATEGORIES,
  ]);
  const [selectedDeletionCategories, setSelectedDeletionCategories] = useState<SupportedCloudDeletionCategory[]>([]);
  const [migrationResult, setMigrationResult] = useState<LocalVaultMigrationResult | null>(null);
  const [deletionPlan, setDeletionPlan] = useState<DeletionPlan | null>(null);
  const [deletionResult, setDeletionResult] = useState<CloudDeletionResult | null>(null);
  const [vaultMessage, setVaultMessage] = useState<string>('');
  const [inventoryMessage, setInventoryMessage] = useState<string>('');
  const [deletionMessage, setDeletionMessage] = useState<string>('');

  const save = (next: PrivacySettings) => {
    writePrivacySettings(next);
  };

  const setMode = (mode: PrivacyMode) => {
    save({ ...settings, mode });
  };

  const setConsent = (key: CloudConsent, enabled: boolean) => {
    save({
      ...settings,
      consents: {
        ...settings.consents,
        [key]: enabled,
      },
    });
  };

  const toggleMigrationCategory = (category: SupportedLocalMigrationCategory) => {
    setSelectedMigrationCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  };

  const toggleDeletionCategory = (category: SupportedCloudDeletionCategory) => {
    setSelectedDeletionCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
    setDeletionPlan(null);
    setDeletionResult(null);
  };

  const refreshVaultStatus = useCallback(async () => {
    if (!user?.id) return;
    try {
      setVaultStatus(await vaultSync.getStatus(user.id));
      setVaultMessage('');
    } catch {
      setVaultStatus(null);
      setVaultMessage('Vault status is unavailable in this runtime.');
    }
  }, [user?.id]);

  const initializeVault = async () => {
    if (!user?.id) return;
    try {
      setVaultStatus(await vaultSync.initialize(user.id));
      setVaultMessage('Local vault initialized.');
    } catch {
      setVaultMessage('Local vault could not be initialized.');
    }
  };

  const refreshInventory = async () => {
    try {
      setInventoryMessage('Refreshing inventory...');
      const response = await fetch('/api/privacy/migration-inventory', {
        cache: 'no-store',
        credentials: 'include',
        headers: {
          ...privacySettingsHeaders(settings),
        },
      });
      if (!response.ok) {
        throw new Error(`Inventory failed: ${response.status}`);
      }
      setInventory(await response.json() as MigrationInventory);
      setInventoryMessage('Inventory refreshed.');
    } catch {
      setInventoryMessage('Migration inventory is unavailable.');
    }
  };

  const runDryRun = async () => {
    if (!user?.id) return;
    try {
      setInventoryMessage('Running dry-run...');
      const response = await fetch('/api/privacy/migration-dry-run', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...privacySettingsHeaders(settings),
        },
        body: JSON.stringify({
          categories: ['habit_definitions', 'habit_logs'],
          sample_limit: 5,
        }),
      });
      if (!response.ok) {
        throw new Error(`Dry-run failed: ${response.status}`);
      }
      const result = await response.json() as MigrationDryRun;
      setDryRun(result);

      const status = await vaultSync.initialize(user.id);
      if (!status) {
        setVaultStatus(null);
        setInventoryMessage(
          `Dry-run fetched ${result.sample_count} sample records; local vault staging requires Ritual Desktop.`,
        );
        return;
      }

      for (const sample of result.samples) {
        const stagingCollection = `migration_dry_run:${sample.collection}`;
        await vaultSync.putRecord({
          userId: user.id,
          collection: stagingCollection,
          recordId: sample.record_id,
          recordType: sample.record_type,
          payload: sample.payload,
          updatedAt: sample.updated_at || undefined,
        });
        await vaultSync.tombstoneRecord(
          user.id,
          stagingCollection,
          sample.record_id,
          sample.record_type,
        );
      }
      setVaultStatus(await vaultSync.getStatus(user.id));
      setInventoryMessage(`Dry-run staged and verified ${result.sample_count} sample records locally.`);
    } catch {
      setInventoryMessage('Migration dry-run could not be completed.');
    }
  };

  const runMigration = async () => {
    if (!user?.id || selectedMigrationCategories.length === 0) return;
    try {
      setInventoryMessage('Migrating selected records...');
      const result = await executeLocalVaultMigration({
        userId: user.id,
        categories: selectedMigrationCategories,
        headers: privacySettingsHeaders(settings),
      });
      setMigrationResult(result);
      setVaultStatus(await vaultSync.getStatus(user.id));
      setInventoryMessage(`Migrated and verified ${result.migratedCount} records locally.`);
    } catch {
      setInventoryMessage('Local vault migration could not be completed.');
    }
  };

  const planCloudDeletion = async () => {
    if (selectedDeletionCategories.length === 0) return;
    try {
      setDeletionMessage('Planning cloud deletion...');
      const response = await fetch('/api/privacy/deletion-plan', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...privacySettingsHeaders(settings),
        },
        body: JSON.stringify({
          categories: selectedDeletionCategories,
        }),
      });
      if (!response.ok) {
        throw new Error(`Deletion plan failed: ${response.status}`);
      }
      const result = await response.json() as DeletionPlan;
      setDeletionPlan(result);
      setDeletionMessage(`Deletion plan ready for ${result.total_records} cloud records.`);
    } catch {
      setDeletionPlan(null);
      setDeletionMessage('Cloud deletion plan could not be generated.');
    }
  };

  const runCloudDeletion = async () => {
    if (!user?.id || selectedDeletionCategories.length === 0 || !deletionPlan) return;
    try {
      setDeletionMessage('Deleting selected cloud copies...');
      const result = await executeCloudBehavioralDeletion({
        userId: user.id,
        categories: selectedDeletionCategories,
        headers: privacySettingsHeaders(settings),
      });
      setDeletionResult(result);
      setVaultStatus(await vaultSync.getStatus(user.id));
      setDeletionMessage(`Deleted ${result.response.deleted_count} cloud records and saved a local receipt.`);
      await refreshInventory();
    } catch {
      setDeletionMessage('Cloud deletion could not be completed. Local migration receipts are required first.');
    }
  };

  useEffect(() => {
    void refreshVaultStatus();
  }, [refreshVaultStatus]);

  return (
    <div className="space-y-[18px]">
      <SettingsGroup>
        <div className="flex items-start gap-3 px-3.5 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#306774]/10 text-[#306774]">
            <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight text-[var(--text-primary)]">Privacy mode</p>
            <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
              Current mode: {MODE_OPTIONS.find((option) => option.value === settings.mode)?.label || 'Local Only'}
            </p>
          </div>
        </div>
      </SettingsGroup>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">Mode</h2>
        <SettingsGroup>
          {MODE_OPTIONS.map((option) => (
            <SettingsRow key={option.value}>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">{option.label}</p>
                <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[var(--text-muted)]">{option.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  'h-7 min-w-[82px] rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                  settings.mode === option.value
                    ? 'border-[#306774] bg-[#306774] text-white'
                    : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                )}
              >
                {settings.mode === option.value ? 'Active' : 'Select'}
              </button>
            </SettingsRow>
          ))}
        </SettingsGroup>
      </section>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">Cloud consent</h2>
        <SettingsGroup>
          {CONSENT_OPTIONS.map((option) => (
            <SettingsRow key={option.key}>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">{option.label}</p>
                <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[var(--text-muted)]">{option.detail}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.consents[option.key] === true}
                onClick={() => setConsent(option.key, settings.consents[option.key] !== true)}
                className={cn(
                  'relative h-4 w-[28px] rounded-full transition-colors',
                  settings.consents[option.key] === true ? 'bg-[#3c7783]' : 'bg-[#d9d9d7]',
                )}
              >
                <span
                  className={cn(
                    'absolute top-[2px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
                    settings.consents[option.key] === true ? 'translate-x-[13px]' : 'translate-x-[2px]',
                  )}
                />
              </button>
            </SettingsRow>
          ))}
        </SettingsGroup>
      </section>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">Local vault</h2>
        <SettingsGroup>
          <div className="flex items-start gap-3 px-3.5 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#306774]/10 text-[#306774]">
              <Database className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">
                {vaultStatus?.initialized ? 'Desktop vault ready' : 'Desktop vault not initialized'}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                {vaultStatus
                  ? `${vaultStatus.recordCount} local records, ${vaultStatus.stagedRecordCount} dry-run staging records, ${vaultStatus.deletionReceiptCount} deletion receipts`
                  : 'The durable encrypted vault is available in Ritual Desktop.'}
              </p>
              {vaultMessage ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{vaultMessage}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={initializeVault}
              className="h-7 rounded-[7px] border border-black/10 bg-white px-3 text-[12px] font-medium text-[#3f3f3f] transition-colors hover:bg-[#f3f3f1]"
            >
              Initialize
            </button>
          </div>
        </SettingsGroup>
      </section>

      <PrivacyPrivateSyncSection
        userId={user?.id}
        settings={settings}
        onVaultStatus={setVaultStatus}
      />

      <PrivacyVaultExportSection
        userId={user?.id}
        onVaultStatus={setVaultStatus}
      />

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">Migration inventory</h2>
        <SettingsGroup>
          <SettingsRow>
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">
                {inventory ? `${inventory.total_records} cloud-backed behavioral records found` : 'Inventory not loaded'}
              </p>
              <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[var(--text-muted)]">
                Inventory, dry-run, and migration do not delete cloud data. Migration makes selected categories local-first on this device.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUPPORTED_LOCAL_MIGRATION_CATEGORIES.map((category) => {
                  const selected = selectedMigrationCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleMigrationCategory(category)}
                      className={cn(
                        'h-6 rounded-[7px] border px-2 text-[11px] font-medium transition-colors',
                        selected
                          ? 'border-[#306774] bg-[#306774] text-white'
                          : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                      )}
                    >
                      {LOCAL_MIGRATION_CATEGORY_LABELS[category]}
                    </button>
                  );
                })}
              </div>
              {inventoryMessage ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{inventoryMessage}</p>
              ) : null}
              {dryRun ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                  Last dry-run: {dryRun.sample_count} samples, hash {dryRun.sample_hash.slice(0, 12)}
                </p>
              ) : null}
              {migrationResult ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                  Last migration: {migrationResult.recordCount} records, hash {migrationResult.localHash.slice(0, 12)}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={refreshInventory}
                className="h-7 rounded-[7px] border border-black/10 bg-white px-3 text-[12px] font-medium text-[#3f3f3f] transition-colors hover:bg-[#f3f3f1]"
              >
                Inventory
              </button>
              <button
                type="button"
                onClick={runDryRun}
                className="h-7 rounded-[7px] border border-[#306774] bg-[#306774] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#285966]"
              >
                Dry-run
              </button>
              <button
                type="button"
                onClick={runMigration}
                disabled={selectedMigrationCategories.length === 0}
                className={cn(
                  'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                  selectedMigrationCategories.length > 0
                    ? 'border-[#306774] bg-[#306774] text-white hover:bg-[#285966]'
                    : 'border-black/10 bg-black/5 text-[#9a9a96]',
                )}
              >
                Migrate
              </button>
            </div>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">Cloud deletion</h2>
        <SettingsGroup>
          <SettingsRow>
            <div className="min-w-0">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#9f2d20]/10 text-[#9f2d20]">
                  <Trash2 className="h-4 w-4" strokeWidth={2.2} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">
                    {deletionPlan ? `${deletionPlan.total_records} selected cloud records planned` : 'No deletion plan loaded'}
                  </p>
                  <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[var(--text-muted)]">
                    Deletion requires a completed local migration receipt for each selected category and writes a local deletion receipt before cloud rows are removed.
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUPPORTED_CLOUD_DELETION_CATEGORIES.map((category) => {
                  const selected = selectedDeletionCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleDeletionCategory(category)}
                      className={cn(
                        'h-6 rounded-[7px] border px-2 text-[11px] font-medium transition-colors',
                        selected
                          ? 'border-[#9f2d20] bg-[#9f2d20] text-white'
                          : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                      )}
                    >
                      {CLOUD_DELETION_CATEGORY_LABELS[category]}
                    </button>
                  );
                })}
              </div>
              {deletionMessage ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{deletionMessage}</p>
              ) : null}
              {deletionResult ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                  Last deletion: {deletionResult.response.deleted_count} deleted, receipt {deletionResult.deletionId.slice(0, 24)}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={planCloudDeletion}
                disabled={selectedDeletionCategories.length === 0}
                className={cn(
                  'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                  selectedDeletionCategories.length > 0
                    ? 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]'
                    : 'border-black/10 bg-black/5 text-[#9a9a96]',
                )}
              >
                Plan
              </button>
              <button
                type="button"
                onClick={runCloudDeletion}
                disabled={selectedDeletionCategories.length === 0 || !deletionPlan}
                className={cn(
                  'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                  selectedDeletionCategories.length > 0 && deletionPlan
                    ? 'border-[#9f2d20] bg-[#9f2d20] text-white hover:bg-[#8b271c]'
                    : 'border-black/10 bg-black/5 text-[#9a9a96]',
                )}
              >
                Delete cloud
              </button>
            </div>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <PrivacyExternalErasureSection
        userId={user?.id}
        onVaultStatus={setVaultStatus}
      />
    </div>
  );
}
