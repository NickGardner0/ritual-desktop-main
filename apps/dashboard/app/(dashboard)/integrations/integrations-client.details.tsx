'use client';

import { getIntegrationPluginByDetailKey } from './plugins/registry';
import type { IntegrationRuntimeContext } from './plugins/types';

export function renderIntegrationDetailsPanel(
  selectedIntegration: string | null,
  ctx: IntegrationRuntimeContext,
) {
  if (!selectedIntegration) return null;
  const descriptor = getIntegrationPluginByDetailKey(selectedIntegration);
  if (!descriptor) return null;
  const DetailPanel = descriptor.DetailPanel;
  return <DetailPanel ctx={ctx} />;
}
