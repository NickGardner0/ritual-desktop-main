import { getBackendBaseUrl } from './backend-url';
import {
  canSendToCloud,
  type CloudConsent,
  type PrivacyDataClass,
} from '@ritual/shared-contracts';

export function getTriggerBackendBaseUrl(): string {
  return getBackendBaseUrl();
}

export async function triggerBackendFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const purpose = classifyTriggerPurpose(path);
  const decision = canSendToCloud({
    mode: parseServerPrivacyMode(),
    consents: parseServerCloudConsents(),
    dataClass: purpose.dataClass,
    destination: 'trigger',
    purpose: purpose.consent,
  });
  if (!decision.allowed) {
    return Response.json(
      {
        error: 'Cloud consent required',
        privacyBlocked: true,
        reason: decision.reason,
        requiredConsent: purpose.consent,
      },
      { status: 403 },
    );
  }

  const base = getTriggerBackendBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${base}${normalizedPath}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'X-Ritual-Privacy-Mode': parseServerPrivacyMode(),
      'X-Ritual-Cloud-Consents': Object.entries(parseServerCloudConsents())
        .filter(([, enabled]) => enabled === true)
        .map(([name]) => name)
        .sort()
        .join(','),
      ...(init?.headers || {}),
    },
  });
}

function parseServerPrivacyMode() {
  const mode = process.env.RITUAL_PRIVACY_MODE;
  return mode === 'private_sync' || mode === 'cloud_intelligence' ? mode : 'local_only';
}

function parseServerCloudConsents(): Partial<Record<CloudConsent, boolean>> {
  return (process.env.RITUAL_CLOUD_CONSENTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Partial<Record<CloudConsent, boolean>>>((acc, item) => {
      acc[item as CloudConsent] = true;
      return acc;
    }, {});
}

function classifyTriggerPurpose(path: string): { consent: CloudConsent; dataClass: PrivacyDataClass } {
  if (path.includes('/sms/')) {
    return { consent: 'sms', dataClass: 'ai_content' };
  }
  if (path.includes('/financial/')) {
    return { consent: 'provider_sync', dataClass: 'financial' };
  }
  return { consent: 'provider_sync', dataClass: 'health_metric' };
}
