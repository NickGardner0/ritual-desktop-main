import { invokeDesktopCommand } from '@/lib/desktop-bridge/commands';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';
import { recordDesktopShellEvent } from '@/lib/desktop-bridge/observability';

export type UpdateManifest = {
  body?: string | null;
  date?: string | null;
  version?: string | null;
};

export type DesktopRuntimeInfo = {
  version: string;
  environment: string;
  capabilities: string[];
  updaterActive: boolean;
  frontendReady: boolean;
  target?: string | null;
  pendingUpdate?: UpdateManifest | null;
};

export type DesktopDatabaseStateKind =
  | 'uninitialized'
  | 'ready_local'
  | 'reloading';

export type DesktopDatabaseHandleState = {
  status: DesktopDatabaseStateKind;
  dbPath: string;
  lastError?: string | null;
};

export type DesktopDatabaseRuntimeState = {
  memory: DesktopDatabaseHandleState;
  activity: DesktopDatabaseHandleState;
  tursoSyncConfigured: boolean;
  localCaptureReady: boolean;
  cloudSyncEnabled: boolean;
  latestLocalEventTs?: number | null;
  latestCloudSyncTs?: number | null;
  cloudSyncBacklog: number;
  cloudSyncLastError?: string | null;
};

export type DesktopWatcherLifecycleState =
  | 'never_enabled'
  | 'disabled_by_user'
  | 'disabled_no_permission'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'backoff';

export type DesktopWatcherRuntimeState = {
  state: DesktopWatcherLifecycleState;
  isRunning: boolean;
  pid?: number | null;
  deviceId?: string | null;
  accessibilityGranted: boolean;
  secondsSinceHeartbeat?: number | null;
  readinessTimeMs?: number | null;
  failureReason?: string | null;
  restartCount: number;
  lastRestartReason?: string | null;
};

export type DesktopAuthRuntimeState = {
  tokenReady: boolean;
  userId?: string | null;
  backendBase?: string | null;
  lastUpdatedAtMs?: number | null;
  lastTursoSyncAtMs?: number | null;
  tursoRefreshScheduledForMs?: number | null;
  lastTursoError?: string | null;
};

export type DesktopProcessMetrics = {
  webviewPid?: number | null;
  webviewRssBytes?: number | null;
  watcherPid?: number | null;
  watcherRssBytes?: number | null;
  watcherRssSampleState: 'sampled' | 'not_applicable' | 'pending' | 'unavailable';
  watcherRssReason?: string | null;
};

export type DesktopRuntimeState = {
  auth: DesktopAuthRuntimeState;
  database: DesktopDatabaseRuntimeState;
  watcher: DesktopWatcherRuntimeState;
  process?: DesktopProcessMetrics;
};

export type DesktopCompatibilityIssue =
  | {
      kind: 'version';
      requiredVersion: string;
      currentVersion: string | null;
    }
  | {
      kind: 'capability';
      requiredCapabilities: string[];
      missingCapabilities: string[];
      currentVersion: string | null;
    };

type DesktopCompatibilityRequirements = {
  minVersion: string | null;
  requiredCapabilities: string[];
};

let runtimeInfoPromise: Promise<DesktopRuntimeInfo | null> | null = null;

function normalizeVersion(version: string): number[] {
  return version
    .split('-')[0]
    .split('.')
    .map((segment) => {
      const value = Number.parseInt(segment, 10);
      return Number.isFinite(value) ? value : 0;
    });
}

export function compareDesktopVersions(current: string, required: string): number {
  const currentParts = normalizeVersion(current);
  const requiredParts = normalizeVersion(required);
  const length = Math.max(currentParts.length, requiredParts.length);

  for (let index = 0; index < length; index += 1) {
    const currentValue = currentParts[index] ?? 0;
    const requiredValue = requiredParts[index] ?? 0;

    if (currentValue > requiredValue) return 1;
    if (currentValue < requiredValue) return -1;
  }

  return 0;
}

export function readDesktopCompatibilityRequirements(): DesktopCompatibilityRequirements {
  const minVersion = process.env.NEXT_PUBLIC_DESKTOP_MIN_VERSION?.trim() || null;
  const requiredCapabilities = (process.env.NEXT_PUBLIC_DESKTOP_REQUIRED_CAPABILITIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    minVersion,
    requiredCapabilities,
  };
}

export function getDesktopCompatibilityIssue(
  runtimeInfo: DesktopRuntimeInfo | null,
  requirements = readDesktopCompatibilityRequirements(),
): DesktopCompatibilityIssue | null {
  if (!requirements.minVersion && requirements.requiredCapabilities.length === 0) {
    return null;
  }

  if (requirements.minVersion) {
    const currentVersion = runtimeInfo?.version ?? null;
    if (!currentVersion || compareDesktopVersions(currentVersion, requirements.minVersion) < 0) {
      return {
        kind: 'version',
        requiredVersion: requirements.minVersion,
        currentVersion,
      };
    }
  }

  if (requirements.requiredCapabilities.length > 0) {
    const available = new Set(runtimeInfo?.capabilities ?? []);
    const missingCapabilities = requirements.requiredCapabilities.filter((capability) => !available.has(capability));
    if (missingCapabilities.length > 0) {
      return {
        kind: 'capability',
        requiredCapabilities: requirements.requiredCapabilities,
        missingCapabilities,
        currentVersion: runtimeInfo?.version ?? null,
      };
    }
  }

  return null;
}

export function buildDesktopCommandOrigin(scope: string): string {
  const trimmedScope = scope.trim() || 'unknown';
  if (typeof window === 'undefined') {
    return trimmedScope;
  }

  const path = window.location.pathname || '/';
  const search = window.location.search || '';
  const suffix = `${path}${search}`;
  return `${trimmedScope}@${suffix}`.slice(0, 180);
}

export function clearDesktopRuntimeInfoCache(): void {
  runtimeInfoPromise = null;
}

export async function desktopFrontendReady(): Promise<DesktopRuntimeInfo | null> {
  if (!isDesktopTauriRuntime()) return null;

  try {
    const result = await invokeDesktopCommand<DesktopRuntimeInfo>('desktop_frontend_ready');
    void recordDesktopShellEvent('desktop.frontend_ready', 'info', {
      version: result?.version ?? null,
      environment: result?.environment ?? null,
    });
    return result;
  } catch (error) {
    void recordDesktopShellEvent('desktop.frontend_ready.failed', 'warn', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.warn('Desktop runtime handshake unavailable:', error);
    return null;
  }
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  if (!isDesktopTauriRuntime()) return null;

  if (runtimeInfoPromise) {
    return runtimeInfoPromise;
  }

  runtimeInfoPromise = invokeDesktopCommand<DesktopRuntimeInfo>('get_desktop_runtime_info')
    .catch((error) => {
      console.warn('Desktop runtime info unavailable:', error);
      return null;
    });

  return runtimeInfoPromise;
}

export async function desktopHasCapability(capability: string): Promise<boolean> {
  const runtimeInfo = await getDesktopRuntimeInfo();
  return Boolean(runtimeInfo?.capabilities.includes(capability));
}

export async function getDesktopRuntimeState(): Promise<DesktopRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;

  try {
    return await invokeDesktopCommand<DesktopRuntimeState>('get_desktop_runtime_state');
  } catch (error) {
    console.warn('Desktop runtime state unavailable:', error);
    return null;
  }
}

export async function desktopSetAuthToken(input: {
  token: string;
  userId?: string | null;
  backendBase?: string | null;
}): Promise<DesktopRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;

  try {
    const result = await invokeDesktopCommand<DesktopRuntimeState>('desktop_set_auth_token', {
      token: input.token,
      userId: input.userId ?? null,
      backendBase: input.backendBase ?? null,
    });
    void recordDesktopShellEvent('desktop.auth_handoff.succeeded', 'info', {
      hasUserId: Boolean(input.userId),
      backendBase: input.backendBase ?? null,
    });
    return result;
  } catch (error) {
    void recordDesktopShellEvent('desktop.auth_handoff.failed', 'error', {
      hasUserId: Boolean(input.userId),
      backendBase: input.backendBase ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    console.warn('Desktop auth handoff unavailable:', error);
    return null;
  }
}

export async function desktopClearAuthState(): Promise<DesktopRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;

  try {
    const result = await invokeDesktopCommand<DesktopRuntimeState>('desktop_clear_auth_state');
    void recordDesktopShellEvent('desktop.auth_clear.succeeded', 'info', {
      tokenReady: result.auth.tokenReady,
      userIdPresent: Boolean(result.auth.userId),
    });
    return result;
  } catch (error) {
    void recordDesktopShellEvent('desktop.auth_clear.failed', 'warn', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.warn('Desktop auth clear unavailable:', error);
    return null;
  }
}

export async function checkDesktopForUpdates(): Promise<DesktopRuntimeInfo | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<DesktopRuntimeInfo>('desktop_manual_update_check');
}

export async function installDesktopUpdate(): Promise<void> {
  if (!isDesktopTauriRuntime()) return;
  await invokeDesktopCommand('desktop_install_update');
}
