'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, parseApiError } from './integrations-client.shared';

interface UsePlaidIntegrationParams {
  fetchHabitLogs: () => unknown;
  fetchHabits: () => unknown;
  getToken: () => Promise<string | null>;
  openUserProfile: () => void;
  plaidConnection: any;
  plaidMfaRequired: boolean;
  refetchOverview: () => unknown;
}

export function usePlaidIntegration({
  fetchHabitLogs,
  fetchHabits,
  getToken,
  openUserProfile,
  plaidConnection,
  plaidMfaRequired,
  refetchOverview,
}: UsePlaidIntegrationParams) {
const [plaidConnecting, setPlaidConnecting] = useState(false);
const [plaidSyncing, setPlaidSyncing] = useState(false);
const [plaidBackfilling, setPlaidBackfilling] = useState(false);
const [plaidSettingsSaving, setPlaidSettingsSaving] = useState(false);
const [plaidAccountSavingId, setPlaidAccountSavingId] = useState<string | null>(null);
  const plaidLoadPromiseRef = useRef<Promise<void> | null>(null);
  const plaidHandlerRef = useRef<{ open: () => void; destroy?: () => void } | null>(null);

  useEffect(() => {
    return () => {
      plaidHandlerRef.current?.destroy?.();
    };
  }, []);

const refetchAfterFinancialSync = useCallback(async () => {
  await Promise.all([
    refetchOverview(),
    fetchHabits(),
    fetchHabitLogs(),
  ]);
}, [fetchHabitLogs, fetchHabits, refetchOverview]);
const ensurePlaidLoaded = useCallback(async () => {
  if (typeof window === 'undefined') {
    throw new Error('Plaid Link is only available in the browser');
  }
  if (window.Plaid) {
    return;
  }
  if (!plaidLoadPromiseRef.current) {
    plaidLoadPromiseRef.current = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector('script[data-plaid-link="true"]') as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Plaid Link')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      script.async = true;
      script.dataset.plaidLink = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Plaid Link'));
      document.body.appendChild(script);
    });
  }
  await plaidLoadPromiseRef.current;
}, []);
// Handle Plaid OAuth return (e.g. after Capital One login in system browser)
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('oauth_state_id')) return;

  const receivedRedirectUri = window.location.href;

  (async () => {
    try {
      setPlaidConnecting(true);
      const token = await getToken();
      if (!token) throw new Error('Authentication required');

      await ensurePlaidLoaded();

      const linkTokenResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/link-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ account_selection_enabled: true }),
      });
      if (!linkTokenResponse.ok) {
        throw new Error('Failed to initialize Plaid Link for OAuth return');
      }
      const { link_token } = await linkTokenResponse.json();

      if (!window.Plaid) throw new Error('Plaid Link did not load');

      plaidHandlerRef.current?.destroy?.();
      plaidHandlerRef.current = window.Plaid.create({
        token: link_token,
        receivedRedirectUri,
        onSuccess: async (publicToken, metadata) => {
          try {
            const exchangeResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/exchange-public-token`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                public_token: publicToken,
                institution_id: metadata?.institution?.institution_id || null,
                institution_name: metadata?.institution?.name || null,
                auto_backfill: true,
              }),
            });
            if (!exchangeResponse.ok) {
              throw new Error('Failed to connect bank account');
            }
            const result = await exchangeResponse.json();
            await refetchAfterFinancialSync();
            alert(result.message || 'Bank connected successfully.');
          } catch (error) {
            console.error('❌ Error exchanging Plaid public token:', error);
            alert(`Failed to connect bank: ${error}`);
          } finally {
            setPlaidConnecting(false);
            plaidHandlerRef.current = null;
            // Clean up the OAuth params from the URL
            window.history.replaceState({}, '', window.location.pathname);
          }
        },
        onExit: (error) => {
          if (error) {
            console.error('❌ Plaid OAuth return failed:', error);
            alert(`Bank connection failed: ${error.display_message || error.error_message || 'Unknown error'}`);
          }
          setPlaidConnecting(false);
          plaidHandlerRef.current = null;
          window.history.replaceState({}, '', window.location.pathname);
        },
      });

      plaidHandlerRef.current.open();
    } catch (error) {
      console.error('❌ Error resuming Plaid OAuth:', error);
      alert(`Failed to complete bank connection: ${error}`);
      setPlaidConnecting(false);
    }
  })();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
const handlePlaidLink = useCallback(async (options?: { updateMode?: boolean }) => {
  try {
    // MFA check disabled — go straight to Plaid Link
    // if (plaidMfaRequired) {
    //   openUserProfile();
    //   throw new Error('Multi-factor authentication must be enabled before connecting a bank account.');
    // }
    setPlaidConnecting(true);
    const token = await getToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    await ensurePlaidLoaded();

    const linkTokenResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/link-token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: options?.updateMode ? plaidConnection?.id : null,
        update_mode: Boolean(options?.updateMode),
        account_selection_enabled: true,
      }),
    });
    if (!linkTokenResponse.ok) {
      throw new Error(await parseApiError(linkTokenResponse, 'Failed to initialize Plaid Link'));
    }

    const linkTokenResult = await linkTokenResponse.json();
    if (!window.Plaid) {
      throw new Error('Plaid Link did not load');
    }

    plaidHandlerRef.current?.destroy?.();
    plaidHandlerRef.current = window.Plaid.create({
      token: linkTokenResult.link_token,
      onSuccess: async (publicToken, metadata) => {
        try {
          if (options?.updateMode) {
            if (!plaidConnection?.id) {
              throw new Error('Plaid connection not found');
            }
            const syncResponse = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/sync`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
            if (!syncResponse.ok) {
              throw new Error(await parseApiError(syncResponse, 'Failed to refresh Plaid connection'));
            }

            await refetchAfterFinancialSync();
            alert('Plaid connection refreshed successfully.');
            return;
          }

          const exchangeResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/exchange-public-token`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              public_token: publicToken,
              institution_id: metadata?.institution?.institution_id || null,
              institution_name: metadata?.institution?.name || null,
              auto_backfill: true,
            }),
          });

          if (!exchangeResponse.ok) {
            throw new Error(await parseApiError(exchangeResponse, 'Failed to connect Plaid'));
          }

          const result = await exchangeResponse.json();
          await refetchAfterFinancialSync();
          alert(result.message || 'Plaid connected successfully.');
        } catch (error) {
          console.error('❌ Error exchanging Plaid public token:', error);
          alert(`Failed to connect Plaid: ${error}`);
        } finally {
          setPlaidConnecting(false);
          plaidHandlerRef.current = null;
        }
      },
      onExit: (error) => {
        if (error) {
          console.error('❌ Plaid Link exited with error:', error);
          alert(`Plaid connection failed: ${error.display_message || error.error_message || 'Unknown error'}`);
        }
        setPlaidConnecting(false);
        plaidHandlerRef.current = null;
      },
    });

    plaidHandlerRef.current.open();
  } catch (error) {
    console.error('❌ Error connecting Plaid:', error);
    alert(`Failed to connect Plaid: ${error}`);
    setPlaidConnecting(false);
  }
}, [ensurePlaidLoaded, getToken, openUserProfile, plaidConnection?.id, plaidMfaRequired, refetchAfterFinancialSync]);

const handlePlaidConnect = useCallback(() => {
  return handlePlaidLink({ updateMode: false });
}, [handlePlaidLink]);

const handlePlaidReconnect = useCallback(() => {
  return handlePlaidLink({ updateMode: true });
}, [handlePlaidLink]);

const handlePlaidMfaSetup = useCallback(() => {
  openUserProfile();
}, [openUserProfile]);

async function handlePlaidSyncSettingsUpdate(
  updates: { auto_sync_enabled?: boolean; sync_hour?: number }
) {
  try {
    if (!plaidConnection?.id) {
      return;
    }
    setPlaidSettingsSaving(true);
    const token = await getToken();
    if (!token) return;

    const nextEnabled = updates.auto_sync_enabled ?? plaidConnection.auto_sync_enabled ?? true;
    const nextHour = updates.sync_hour ?? plaidConnection.sync_hour ?? 9;

    const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/sync-settings`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auto_sync_enabled: nextEnabled,
        sync_hour: nextHour,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update Plaid sync settings');
    }

    await refetchOverview();
  } catch (error) {
    console.error('❌ Error updating Plaid sync settings:', error);
    alert(`Failed to update Plaid sync settings: ${error}`);
  } finally {
    setPlaidSettingsSaving(false);
  }
}

async function handlePlaidAccountInclusion(accountId: string, includeInSpending: boolean) {
  try {
    if (!plaidConnection?.id) {
      return;
    }
    setPlaidAccountSavingId(accountId);
    const token = await getToken();
    if (!token) return;

    const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/accounts/${accountId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        include_in_spending: includeInSpending,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update account preference');
    }

    await refetchAfterFinancialSync();
  } catch (error) {
    console.error('❌ Error updating Plaid account preference:', error);
    alert(`Failed to update account preference: ${error}`);
  } finally {
    setPlaidAccountSavingId(null);
  }
}

async function handlePlaidBackfill() {
  try {
    if (!plaidConnection?.id) {
      throw new Error('Plaid connection not found');
    }
    setPlaidBackfilling(true);
    const token = await getToken();
    if (!token) return;

    const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/backfill`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Backfill failed');
    }

    const result = await response.json();
    await refetchAfterFinancialSync();
    alert(
      `Backfill completed.\n\n` +
      `Transactions seen: ${result.items_seen || 0}\n` +
      `Daily spending days updated: ${result.rollup?.days_completed || 0}`
    );
  } catch (error) {
    console.error('❌ Error backfilling Plaid history:', error);
    alert(`Failed to backfill Plaid history: ${error}`);
  } finally {
    setPlaidBackfilling(false);
  }
}

async function handlePlaidSync() {
  try {
    if (!plaidConnection?.id) {
      throw new Error('Plaid connection not found');
    }
    setPlaidSyncing(true);
    const token = await getToken();
    if (!token) return;

    const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Sync failed');
    }

    const result = await response.json();
    await refetchAfterFinancialSync();
    alert(
      `Sync completed.\n\n` +
      `Transactions seen: ${result.items_seen || 0}\n` +
      `Transactions written: ${result.items_written || 0}\n` +
      `Daily spending days updated: ${result.rollup?.days_completed || 0}`
    );
  } catch (error) {
    console.error('❌ Error syncing Plaid:', error);
    alert(`Failed to sync Plaid: ${error}`);
  } finally {
    setPlaidSyncing(false);
  }
}

async function handlePlaidDisconnect() {
  try {
    if (!plaidConnection?.id) {
      return;
    }
    const token = await getToken();
    if (!token) return;

    if (!confirm('Disconnect Plaid? Existing spending logs will remain unless you resync later.')) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to disconnect Plaid');
    }

    await refetchOverview();
    alert('Plaid disconnected successfully.');
  } catch (error) {
    console.error('❌ Error disconnecting Plaid:', error);
    alert(`Failed to disconnect Plaid: ${error}`);
  }
}



  return {
    handlePlaidAccountInclusion,
    handlePlaidBackfill,
    handlePlaidConnect,
    handlePlaidDisconnect,
    handlePlaidMfaSetup,
    handlePlaidReconnect,
    handlePlaidSync,
    handlePlaidSyncSettingsUpdate,
    plaidAccountSavingId,
    plaidBackfilling,
    plaidConnecting,
    plaidSettingsSaving,
    plaidSyncing,
  };
}
