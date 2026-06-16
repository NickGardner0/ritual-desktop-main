'use client';

import { Button } from '@/components/ui/button';
import type { IntegrationRuntimeContext } from '../types';

export function PanelAction({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const { handleWhoopSync, syncing } = ctx;

  return (
    <Button
      onClick={() => (handleWhoopSync as () => void)()}
      disabled={Boolean(syncing)}
      variant="outline"
      className="h-11 rounded-sm border-[#1f1e1a] px-4 text-sm text-[#1f1e1a] hover:bg-[#f3f1ea]"
    >
      {syncing ? 'Syncing...' : 'Quick sync'}
    </Button>
  );
}
