'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useUser } from '@clerk/nextjs';
import { LockKeyhole, ShieldCheck, Trash2 } from 'lucide-react';
import type { CloudConsent } from '@ritual/shared-contracts';
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

type MigrationInventory = {
  checked_at: string;
  deletes_cloud_data: boolean;
  total_records: number;
  categories: Array<{
    category: string;
    description: string;
    record_count: number;
    status: string;
    checked_at: string;
  }>;
};

type MigrationDryRun = {
  deletes_cloud_data: boolean;
  changes_source_of_truth: boolean;
  sample_count: number;
  sample_hash: string;
  samples: Array<{
    collection: string;
    record_id: string;
    record_type: string;
    updated_at?: string | null;
    payload: unknown;
  }>;
};

function PrivacyToggle({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-5 w-[38px] flex-shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-black' : 'bg-[#d1d1d1]',
      )}
    >
      <span
        className={cn(
          'inline-block h-[17px] w-[17px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.28),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform',
          checked ? 'translate-x-[19px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function PrivacySettingsPanel() {
  const { user } = useUser();
  const settings = useSyncExternalStore(
    subscribeToPrivacySettings,
    readPrivacySettings,
    () => DEFAULT_PRIVACY_SETTINGS,
  );
  const [vaultStatus, setVaultStatus] = useState<DesktopVaultStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [inventory, setInventory] = useState<MigrationInventory | null>(null);
  const [dryRun, setDryRun] = useState<MigrationDryRun | null>(null);
  const [selectedMigrationCategories, setSelectedMigrationCategories] = useState<SupportedLocalMigrationCategory[]>([
    ...SUPPORTED_LOCAL_MIGRATION_CATEGORIES,
  ]);
  const [selectedDeletionCategories, setSelectedDeletionCategories] = useState<SupportedCloudDeletionCategory[]>([]);
  const [migrationResult, setMigrationResult] = useState<LocalVaultMigrationResult | null>(null);
  const [deletionPlan, setDeletionPlan] = useState<DeletionPlan | null>(null);
  const [deletionResult, setDeletionResult] = useState<CloudDeletionResult | null>(null);
  const [inventoryMessage, setInventoryMessage] = useState('');
  const [deletionMessage, setDeletionMessage] = useState('');

  const encryptedSyncEnabled = settings.mode === 'private_sync' || settings.mode === 'cloud_intelligence';
  const providerSyncEnabled = settings.consents.provider_sync === true;

  const save = (next: PrivacySettings) => {
    writePrivacySettings(next);
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
  };

  const refreshInventory = async () => {
    try {
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

  const refreshVaultStatus = useCallback(async () => {
    if (!user?.id) return;
    try {
      setVaultStatus(await vaultSync.getStatus(user.id));
    } catch {
      setVaultStatus(null);
    }
  }, [user?.id]);

  const ensureVaultReady = useCallback(async () => {
    if (!user?.id) return;
    try {
      const status = vaultStatus?.initialized
        ? vaultStatus
        : await vaultSync.initialize(user.id);
      setVaultStatus(status);
    } catch {
      setStatusMessage('Encrypted sync is on. Vault setup can finish later on this device.');
    }
  }, [user?.id, vaultStatus]);

  const setEncryptedCloudSync = async (enabled: boolean) => {
    if (enabled) {
      save({
        ...settings,
        mode: 'private_sync',
      });
      setStatusMessage('Encrypted cloud sync is on. Only encrypted vault data can leave this device.');
      await ensureVaultReady();
      return;
    }

    save({
      ...settings,
      mode: 'local_only',
      consents: {
        ...settings.consents,
        provider_sync: false,
        plaintext_sync: false,
      },
    });
    setStatusMessage('Everything stays on this device until you turn sync back on.');
  };

  const setProviderSync = async (enabled: boolean) => {
    if (enabled) {
      const nextMode = encryptedSyncEnabled ? settings.mode : 'private_sync';
      save({
        ...settings,
        mode: nextMode === 'local_only' ? 'private_sync' : nextMode,
        consents: {
          ...settings.consents,
          provider_sync: true,
        },
      });
      setStatusMessage('Connected apps and wearables can sync.');
      if (!encryptedSyncEnabled) {
        await ensureVaultReady();
      }
      return;
    }

    setConsent('provider_sync', false);
    setStatusMessage('Connected apps and wearables will stay paused.');
  };

  useEffect(() => {
    void refreshVaultStatus();
  }, [refreshVaultStatus]);

  return (
    <div className="space-y-[18px]">
      <SettingsGroup>
        <div className="flex items-start gap-3 px-3.5 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-black/[0.06] text-[#1d1d1f]">
            <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight text-[#1d1d1f]">Private by default</p>
            <p className="mt-1 text-[12px] leading-snug text-[#8a8a8a]">
              Ritual keeps your data on this device unless you choose to sync.
            </p>
          </div>
        </div>
      </SettingsGroup>

      <section>
        <h2 className="mb-[8px] text-[13px] font-semibold leading-tight text-[#1d1d1f]">Sync</h2>
        <SettingsGroup>
          <SettingsRow>
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[#7a7a7a]">
                <LockKeyhole className="h-[15px] w-[15px]" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-[16px] text-[#1d1d1f]">Encrypted cloud sync</p>
                <p className="mt-[2px] max-w-[330px] text-[12px] leading-[15px] text-[#8a8a8a]">
                  Sync an encrypted copy of your vault across your devices. Ritual cannot read the contents.
                </p>
              </div>
            </div>
            <PrivacyToggle
              checked={encryptedSyncEnabled}
              onClick={() => void setEncryptedCloudSync(!encryptedSyncEnabled)}
            />
          </SettingsRow>

          <SettingsRow>
            <div className="min-w-0 pl-[34px]">
              <p className="text-[13px] font-medium leading-[16px] text-[#1d1d1f]">Apps & wearables</p>
              <p className="mt-[2px] max-w-[330px] text-[12px] leading-[15px] text-[#8a8a8a]">
                Allow Whoop, finance, and other connected services to sync with Ritual.
              </p>
            </div>
            <PrivacyToggle
              checked={providerSyncEnabled}
              onClick={() => void setProviderSync(!providerSyncEnabled)}
            />
          </SettingsRow>
        </SettingsGroup>
      </section>

      {statusMessage ? (
        <p className="px-0.5 text-[12px] leading-snug text-[#8a8a8a]">{statusMessage}</p>
      ) : null}

      {vaultStatus?.initialized ? (
        <p className="px-0.5 text-[11px] leading-snug text-[#9a9a96]">
          Local vault ready · {vaultStatus.recordCount} records on this device
        </p>
      ) : null}

      <section>
        <h2 className="mb-[8px] text-[13px] font-semibold leading-tight text-[#1d1d1f]">Migration inventory</h2>
        <SettingsGroup>
          <SettingsRow>
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-tight text-[#1d1d1f]">
                {inventory ? `${inventory.total_records} cloud-backed behavioral records found` : 'Inventory not loaded'}
              </p>
              <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[#8a8a8a]">
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
                          ? 'border-[#1d1d1f] bg-[#1d1d1f] text-white'
                          : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                      )}
                    >
                      {LOCAL_MIGRATION_CATEGORY_LABELS[category]}
                    </button>
                  );
                })}
              </div>
              {inventoryMessage ? (
                <p className="mt-1 text-[11px] leading-snug text-[#8a8a8a]">{inventoryMessage}</p>
              ) : null}
              {dryRun ? (
                <p className="mt-1 text-[11px] leading-snug text-[#8a8a8a]">
                  Last dry-run: {dryRun.sample_count} samples, hash {dryRun.sample_hash.slice(0, 12)}
                </p>
              ) : null}
              {migrationResult ? (
                <p className="mt-1 text-[11px] leading-snug text-[#8a8a8a]">
                  Last migration: {migrationResult.recordCount} records, hash {migrationResult.localHash.slice(0, 12)}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void refreshInventory()}
                className="h-7 rounded-[7px] border border-black/10 bg-white px-3 text-[12px] font-medium text-[#3f3f3f] transition-colors hover:bg-[#f3f3f1]"
              >
                Inventory
              </button>
              <button
                type="button"
                onClick={() => void runDryRun()}
                className="h-7 rounded-[7px] border border-[#1d1d1f] bg-[#1d1d1f] px-3 text-[12px] font-medium text-white transition-colors hover:bg-black"
              >
                Dry-run
              </button>
              <button
                type="button"
                onClick={() => void runMigration()}
                disabled={selectedMigrationCategories.length === 0}
                className={cn(
                  'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                  selectedMigrationCategories.length > 0
                    ? 'border-[#1d1d1f] bg-[#1d1d1f] text-white hover:bg-black'
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
        <h2 className="mb-[8px] text-[13px] font-semibold leading-tight text-[#1d1d1f]">Cloud deletion</h2>
        <SettingsGroup>
          <SettingsRow>
            <div className="min-w-0">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#9f2d20]/10 text-[#9f2d20]">
                  <Trash2 className="h-4 w-4" strokeWidth={2.2} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-tight text-[#1d1d1f]">
                    {deletionPlan ? `${deletionPlan.total_records} selected cloud records planned` : 'No deletion plan loaded'}
                  </p>
                  <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[#8a8a8a]">
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
                <p className="mt-1 text-[11px] leading-snug text-[#8a8a8a]">{deletionMessage}</p>
              ) : null}
              {deletionResult ? (
                <p className="mt-1 text-[11px] leading-snug text-[#8a8a8a]">
                  Last deletion: {deletionResult.response.deleted_count} deleted, receipt {deletionResult.deletionId.slice(0, 24)}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void planCloudDeletion()}
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
                onClick={() => void runCloudDeletion()}
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

      <PrivacyPrivateSyncSection
        userId={user?.id}
        settings={settings}
        onVaultStatus={setVaultStatus}
      />

      <PrivacyVaultExportSection
        userId={user?.id}
        onVaultStatus={setVaultStatus}
      />

      <PrivacyExternalErasureSection
        userId={user?.id}
        onVaultStatus={setVaultStatus}
      />
    </div>
  );
}
