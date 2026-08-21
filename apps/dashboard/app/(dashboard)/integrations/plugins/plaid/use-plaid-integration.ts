'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';

function plaidApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof BackendClientError) {
    try {
      const payload = JSON.parse(error.responseBody) as {
        detail?: string | { display_message?: string; error_message?: string; message?: string };
      };
      const detail = payload?.detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (detail && typeof detail === 'object') {
        return detail.display_message || detail.error_message || detail.message || fallback;
      }
    } catch {
      // Keep the fallback when FastAPI doesn't return JSON.
    }
  }
  return error instanceof Error ? error.message : fallback;
}

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
      if (!(await getToken())) throw new Error('Authentication required');

      await ensurePlaidLoaded();

      const { link_token } = await apiOperationWithAuth(
        'create_plaid_link_token_api_financial_plaid_link_token_post',
        getToken,
        { body: { account_selection_enabled: true } },
      );

      if (!window.Plaid) throw new Error('Plaid Link did not load');

      plaidHandlerRef.current?.destroy?.();
      plaidHandlerRef.current = window.Plaid.create({
        token: link_token,
        receivedRedirectUri,
        onSuccess: async (publicToken, metadata) => {
          try {
            const result = await apiOperationWithAuth(
              'exchange_plaid_public_token_api_financial_plaid_exchange_public_token_post',
              getToken,
              {
                body: {
                  public_token: publicToken,
                  institution_id: metadata?.institution?.institution_id || null,
                  institution_name: metadata?.institution?.name || null,
                  auto_backfill: true,
                },
              },
            );
            await refetchAfterFinancialSync();
            alert(result.message || 'Bank connected successfully.');
          } catch (error) {
            console.error('❌ Error exchanging Plaid public token:', error);
            alert(`Failed to connect bank: ${plaidApiErrorMessage(error, 'Unknown error')}`);
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
      alert(`Failed to complete bank connection: ${plaidApiErrorMessage(error, 'Unknown error')}`);
      setPlaidConnecting(false);
    }
  })();
}, []);
const handlePlaidLink = useCallback(async (options?: { updateMode?: boolean }) => {
  try {
    // MFA check disabled — go straight to Plaid Link
    // if (plaidMfaRequired) {
    //   openUserProfile();
    //   throw new Error('Multi-factor authentication must be enabled before connecting a bank account.');
    // }
    setPlaidConnecting(true);
    if (!(await getToken())) {
      throw new Error('Authentication required');
    }

    await ensurePlaidLoaded();

    const linkTokenResult = await apiOperationWithAuth(
      'create_plaid_link_token_api_financial_plaid_link_token_post',
      getToken,
      {
        body: {
          connection_id: options?.updateMode ? plaidConnection?.id : null,
          update_mode: Boolean(options?.updateMode),
          account_selection_enabled: true,
        },
      },
    );
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
            await apiOperationWithAuth(
              'sync_financial_connection_api_financial_connections__connection_id__sync_post',
              getToken,
              { pathParams: { connection_id: plaidConnection.id } },
            );

            await refetchAfterFinancialSync();
            alert('Plaid connection refreshed successfully.');
            return;
          }

          const result = await apiOperationWithAuth(
            'exchange_plaid_public_token_api_financial_plaid_exchange_public_token_post',
            getToken,
            {
              body: {
                public_token: publicToken,
                institution_id: metadata?.institution?.institution_id || null,
                institution_name: metadata?.institution?.name || null,
                auto_backfill: true,
              },
            },
          );
          await refetchAfterFinancialSync();
          alert(result.message || 'Plaid connected successfully.');
        } catch (error) {
          console.error('❌ Error exchanging Plaid public token:', error);
          alert(`Failed to connect Plaid: ${plaidApiErrorMessage(error, 'Unknown error')}`);
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
    alert(`Failed to connect Plaid: ${plaidApiErrorMessage(error, 'Unknown error')}`);
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
    if (!(await getToken())) return;

    const nextEnabled = updates.auto_sync_enabled ?? plaidConnection.auto_sync_enabled ?? true;
    const nextHour = updates.sync_hour ?? plaidConnection.sync_hour ?? 9;

    await apiOperationWithAuth(
      'update_financial_sync_settings_api_financial_connections__connection_id__sync_settings_put',
      getToken,
      {
        pathParams: { connection_id: plaidConnection.id },
        body: {
          auto_sync_enabled: nextEnabled,
          sync_hour: nextHour,
        },
      },
    );

    await refetchOverview();
  } catch (error) {
    console.error('❌ Error updating Plaid sync settings:', error);
    alert(`Failed to update Plaid sync settings: ${plaidApiErrorMessage(error, 'Unknown error')}`);
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
    if (!(await getToken())) return;

    await apiOperationWithAuth(
      'update_financial_account_preferences_api_financial_connections__connection_id__accounts__account_id__put',
      getToken,
      {
        pathParams: {
          connection_id: plaidConnection.id,
          account_id: accountId,
        },
        body: { include_in_spending: includeInSpending },
      },
    );

    await refetchAfterFinancialSync();
  } catch (error) {
    console.error('❌ Error updating Plaid account preference:', error);
    alert(`Failed to update account preference: ${plaidApiErrorMessage(error, 'Unknown error')}`);
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
    if (!(await getToken())) return;

    const result = await apiOperationWithAuth(
      'backfill_financial_connection_api_financial_connections__connection_id__backfill_post',
      getToken,
      { pathParams: { connection_id: plaidConnection.id } },
    );
    await refetchAfterFinancialSync();
    alert(
      `Backfill completed.\n\n` +
      `Transactions seen: ${result.items_seen || 0}\n` +
      `Daily spending days updated: ${result.rollup?.days_completed || 0}`
    );
  } catch (error) {
    console.error('❌ Error backfilling Plaid history:', error);
    alert(`Failed to backfill Plaid history: ${plaidApiErrorMessage(error, 'Unknown error')}`);
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
    if (!(await getToken())) return;

    const result = await apiOperationWithAuth(
      'sync_financial_connection_api_financial_connections__connection_id__sync_post',
      getToken,
      { pathParams: { connection_id: plaidConnection.id } },
    );
    await refetchAfterFinancialSync();
    alert(
      `Sync completed.\n\n` +
      `Transactions seen: ${result.items_seen || 0}\n` +
      `Transactions written: ${result.items_written || 0}\n` +
      `Daily spending days updated: ${result.rollup?.days_completed || 0}`
    );
  } catch (error) {
    console.error('❌ Error syncing Plaid:', error);
    alert(`Failed to sync Plaid: ${plaidApiErrorMessage(error, 'Unknown error')}`);
  } finally {
    setPlaidSyncing(false);
  }
}

async function handlePlaidDisconnect() {
  try {
    if (!plaidConnection?.id) {
      return;
    }
    if (!(await getToken())) return;

    if (!confirm('Disconnect Plaid? Existing spending logs will remain unless you resync later.')) {
      return;
    }

    await apiOperationWithAuth(
      'disconnect_financial_connection_api_financial_connections__connection_id__delete',
      getToken,
      { pathParams: { connection_id: plaidConnection.id } },
    );

    await refetchOverview();
    alert('Plaid disconnected successfully.');
  } catch (error) {
    console.error('❌ Error disconnecting Plaid:', error);
    alert(`Failed to disconnect Plaid: ${plaidApiErrorMessage(error, 'Unknown error')}`);
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
