/**
 * Integrations Loading Shell
 *
 * Instant loading state shown while the Integrations page data is fetched.
 */

import { IntegrationsMarketplaceSkeleton } from './integrations-client.cards';

export default function IntegrationsLoading() {
  return (
    <div className="flex-1 overflow-auto">
      <IntegrationsMarketplaceSkeleton />
    </div>
  );
}
