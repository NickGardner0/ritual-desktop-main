'use client';

import type { IntegrationRuntimeContext } from '../types';

export function PanelAction({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const {
    computerTrackingConnected,
    computerTrackingConnecting,
    handleComputerTrackingConnect,
    handleComputerTrackingDisconnect,
  } = ctx;

  if (computerTrackingConnected) {
    return (
      <button
        type="button"
        onClick={() => void handleComputerTrackingDisconnect()}
        disabled={computerTrackingConnecting}
        className="rounded-sm border border-[#1f1e1a] px-4 py-2 text-sm hover:bg-[#f3f1ea] disabled:opacity-50"
      >
        {computerTrackingConnecting ? 'Pausing...' : 'Pause'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleComputerTrackingConnect()}
      disabled={computerTrackingConnecting}
      className="rounded-sm border border-[#1f1e1a] px-4 py-2 text-sm hover:bg-[#f3f1ea] disabled:opacity-50"
    >
      {computerTrackingConnecting ? 'Starting...' : 'Start'}
    </button>
  );
}
