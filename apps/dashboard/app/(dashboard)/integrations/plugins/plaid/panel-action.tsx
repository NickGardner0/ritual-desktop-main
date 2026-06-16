'use client';

import type { IntegrationRuntimeContext } from '../types';

export function PanelAction({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const {
    handlePlaidConnect,
    handlePlaidReconnect,
    handlePlaidSync,
    plaidConnected,
    plaidConnecting,
    plaidNeedsReconnect,
    plaidSyncing,
  } = ctx;

  if (!plaidConnected) {
    return (
      <button
        onClick={handlePlaidConnect as () => void}
        disabled={Boolean(plaidConnecting)}
        className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
      >
        {plaidConnecting ? 'Connecting...' : 'Connect'}
      </button>
    );
  }

  if (plaidNeedsReconnect) {
    return (
      <button
        onClick={handlePlaidReconnect as () => void}
        disabled={Boolean(plaidConnecting)}
        className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
      >
        {plaidConnecting ? 'Reconnecting...' : 'Reconnect'}
      </button>
    );
  }

  return (
    <button
      onClick={handlePlaidSync as () => void}
      disabled={Boolean(plaidSyncing)}
      className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
    >
      {plaidSyncing ? 'Syncing...' : 'Sync now'}
    </button>
  );
}
