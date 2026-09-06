import { getBackendBaseUrl } from './backend-url';
import {
  createBackendClient,
  type BackendClientOptions,
} from './generated/backend-client';

export function createServerBackendClient(
  getAuthHeaders: BackendClientOptions['getAuthHeaders'],
) {
  return createBackendClient({
    baseUrl: getBackendBaseUrl(),
    getAuthHeaders,
  });
}
