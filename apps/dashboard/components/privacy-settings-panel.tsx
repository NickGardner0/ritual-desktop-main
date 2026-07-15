'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useUser } from '@clerk/nextjs';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import type { CloudConsent } from '@ritual/shared-contracts';
import {
  DEFAULT_PRIVACY_SETTINGS,
  readPrivacySettings,
  writePrivacySettings,
  type PrivacySettings,
} from '@/lib/privacy/privacy-settings';
import {
  vaultSync,
  type DesktopVaultStatus,
} from '@/lib/privacy/vault-sync';
import {
  SettingsGroup,
  SettingsRow,
} from '@/components/ui/ritual-system';
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
    </div>
  );
}
