'use client';

import type { IntegrationRuntimeContext } from '../types';

export function PanelAction({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const {
    handleIphoneTimeConnect,
    handleIphoneTimeSync,
    iphoneTimeConnecting,
    iphoneTimeIntegration,
    iphoneTimeStatusLoading,
    iphoneTimeSyncing,
  } = ctx;

  const status = iphoneTimeIntegration as
    | { isConnected?: boolean; status?: string }
    | undefined;

  const hasSyncableState =
    status?.isConnected || status?.status === 'queued' || status?.status === 'source_ready';

  if (hasSyncableState) {
    return (
      <button
        onClick={handleIphoneTimeSync as () => void}
        disabled={Boolean(iphoneTimeSyncing)}
        className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
      >
        {iphoneTimeSyncing ? 'Syncing...' : 'Sync now'}
      </button>
    );
  }

  return (
    <button
      onClick={handleIphoneTimeConnect as () => void}
      disabled={Boolean(iphoneTimeConnecting) || Boolean(iphoneTimeStatusLoading)}
      className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
    >
      {iphoneTimeConnecting || iphoneTimeStatusLoading ? 'Checking...' : 'Connect'}
    </button>
  );
}
