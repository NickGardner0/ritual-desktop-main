'use client';

import { useCallback, useState } from 'react';
import { LockKeyhole } from 'lucide-react';

import type { PrivacySettings } from '@/lib/privacy/privacy-settings';
import {
  privacySettingsHeaders,
  writePrivacySettings,
} from '@/lib/privacy/privacy-settings';
import type { DesktopVaultStatus } from '@/lib/privacy/vault-client';
import { getDesktopVaultStatus } from '@/lib/privacy/vault-client';
import {
  PRIVATE_SYNC_CATEGORY_LABELS,
  SUPPORTED_PRIVATE_SYNC_CATEGORIES,
  ensurePrivateSyncKey,
  pullPrivateSyncEnvelopes,
  pushPrivateSyncEnvelopes,
  type PrivateSyncPullResult,
  type PrivateSyncPushResult,
  type SupportedPrivateSyncCategory,
} from '@/lib/privacy/vault-private-sync';
import {
  listPrivateSyncDevices,
  registerPrivateSyncDevice,
  revokePrivateSyncDevice,
  type PrivateSyncDevice,
} from '@/lib/privacy/vault-private-sync-devices';
import {
  SettingsGroup,
  SettingsRow,
} from '@/components/ui/ritual-system';
import { cn } from '@/lib/utils';

type Props = {
  userId?: string | null;
  settings: PrivacySettings;
  onVaultStatus: (status: DesktopVaultStatus | null) => void;
};

export function PrivacyPrivateSyncSection({ userId, settings, onVaultStatus }: Props) {
  const [selectedCategories, setSelectedCategories] = useState<SupportedPrivateSyncCategory[]>([
    ...SUPPORTED_PRIVATE_SYNC_CATEGORIES,
  ]);
  const [pushResult, setPushResult] = useState<PrivateSyncPushResult | null>(null);
  const [pullResult, setPullResult] = useState<PrivateSyncPullResult | null>(null);
  const [devices, setDevices] = useState<PrivateSyncDevice[]>([]);
  const [message, setMessage] = useState('');

  const toggleCategory = (category: SupportedPrivateSyncCategory) => {
    setSelectedCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  };

  const refreshDevices = useCallback(async (activeSettings = settings) => {
    if (!userId || activeSettings.mode === 'local_only') return;
    const result = await listPrivateSyncDevices({
      userId,
      headers: privacySettingsHeaders(activeSettings),
    });
    setDevices(result.devices);
  }, [settings, userId]);

  const setupPrivateSync = async () => {
    if (!userId) return;
    try {
      setMessage('Preparing Private Sync...');
      const activeSettings = settings.mode === 'local_only'
        ? writePrivacySettings({ ...settings, mode: 'private_sync' })
        : settings;
      const key = await ensurePrivateSyncKey({ userId });
      const device = await registerPrivateSyncDevice({
        userId,
        headers: privacySettingsHeaders(activeSettings),
      });
      await refreshDevices(activeSettings);
      onVaultStatus(await getDesktopVaultStatus(userId));
      setMessage(
        `${key.created ? 'Created' : 'Found'} local Private Sync key ${key.keyVersion}; this device is ${device.status}.`,
      );
    } catch {
      setMessage('Private Sync could not be prepared in this runtime.');
    }
  };

  const pushPrivateSync = async () => {
    if (!userId || selectedCategories.length === 0) return;
    if (settings.mode === 'local_only') {
      setMessage('Select Private Sync mode before pushing encrypted envelopes.');
      return;
    }
    try {
      setMessage('Encrypting and pushing selected local records...');
      const result = await pushPrivateSyncEnvelopes({
        userId,
        categories: selectedCategories,
        headers: privacySettingsHeaders(settings),
      });
      setPushResult(result);
      onVaultStatus(await getDesktopVaultStatus(userId));
      setMessage(
        `Pushed ${result.envelopeCount} encrypted envelopes; ${result.skippedUnchangedCount} unchanged records skipped.`,
      );
      await refreshDevices();
    } catch {
      setMessage('Private Sync push could not be completed.');
    }
  };

  const pullPrivateSync = async () => {
    if (!userId) return;
    if (settings.mode === 'local_only') {
      setMessage('Select Private Sync mode before pulling encrypted envelopes.');
      return;
    }
    try {
      setMessage('Pulling and decrypting Private Sync envelopes...');
      const result = await pullPrivateSyncEnvelopes({
        userId,
        headers: privacySettingsHeaders(settings),
      });
      setPullResult(result);
      onVaultStatus(await getDesktopVaultStatus(userId));
      setMessage(`Pulled ${result.pulledCount} envelopes and applied ${result.appliedCount} records locally.`);
      await refreshDevices();
    } catch {
      setMessage('Private Sync pull could not be completed.');
    }
  };

  const revokeDevice = async (deviceId: string) => {
    if (!userId) return;
    if (!window.confirm('Revoke this Private Sync device? The device will no longer be able to push or pull encrypted envelopes.')) {
      return;
    }
    try {
      setMessage('Revoking Private Sync device...');
      await revokePrivateSyncDevice({
        userId,
        deviceId,
        headers: privacySettingsHeaders(settings),
      });
      await refreshDevices();
      setMessage('Private Sync device revoked.');
    } catch {
      setMessage('Private Sync device could not be revoked from this device.');
    }
  };

  return (
    <section>
      <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">Private sync</h2>
      <SettingsGroup>
        <SettingsRow>
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#0f7f86]/10 text-[#0f7f86]">
                <LockKeyhole className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">
                  Optional encrypted vault envelopes
                </p>
                <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[var(--text-muted)]">
                  Private Sync encrypts selected local vault categories on this device before sending envelopes to the backend.
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUPPORTED_PRIVATE_SYNC_CATEGORIES.map((category) => {
                const selected = selectedCategories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className={cn(
                      'h-6 rounded-[7px] border px-2 text-[11px] font-medium transition-colors',
                      selected
                        ? 'border-[#0f7f86] bg-[#0f7f86] text-white'
                        : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                    )}
                  >
                    {PRIVATE_SYNC_CATEGORY_LABELS[category]}
                  </button>
                );
              })}
            </div>
            {message ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{message}</p>
            ) : null}
            {pushResult ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Last push: {pushResult.acceptedCount} accepted, revision {pushResult.maxServerRevision}
              </p>
            ) : null}
            {pullResult ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Last pull: {pullResult.appliedCount} applied, revision {pullResult.nextSinceServerRevision}
              </p>
            ) : null}
            {devices.length > 0 ? (
              <div className="mt-2 space-y-1">
                {devices.map((device) => (
                  <div key={device.device_id} className="flex min-h-7 items-center justify-between gap-3 rounded-[7px] border border-black/10 bg-white px-2 py-1">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-[#2b2b2b]">{device.device_name}</p>
                      <p className="truncate text-[10px] text-[var(--text-muted)]">
                        {device.status} · {device.platform || 'device'} · {device.device_id.slice(0, 18)}
                      </p>
                    </div>
                    {device.status !== 'revoked' ? (
                      <button
                        type="button"
                        onClick={() => void revokeDevice(device.device_id)}
                        className="h-6 shrink-0 rounded-[7px] border border-[#9f2d20]/20 bg-white px-2 text-[11px] font-medium text-[#9f2d20] transition-colors hover:bg-[#9f2d20]/5"
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={setupPrivateSync}
              className="h-7 rounded-[7px] border border-black/10 bg-white px-3 text-[12px] font-medium text-[#3f3f3f] transition-colors hover:bg-[#f3f3f1]"
            >
              Setup
            </button>
            <button
              type="button"
              onClick={() => void refreshDevices()}
              disabled={settings.mode === 'local_only'}
              className={cn(
                'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                settings.mode !== 'local_only'
                  ? 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              Devices
            </button>
            <button
              type="button"
              onClick={pushPrivateSync}
              disabled={selectedCategories.length === 0}
              className={cn(
                'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                selectedCategories.length > 0
                  ? 'border-[#0f7f86] bg-[#0f7f86] text-white hover:bg-[#0d7076]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              Push
            </button>
            <button
              type="button"
              onClick={pullPrivateSync}
              className="h-7 rounded-[7px] border border-[#0f7f86] bg-[#0f7f86] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#0d7076]"
            >
              Pull
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </section>
  );
}
