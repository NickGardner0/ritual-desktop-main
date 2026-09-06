import { invokeDesktopCommand } from '@/lib/desktop-bridge/commands';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';
import { recordDesktopShellEvent } from '@/lib/desktop-bridge/observability';
import type { CloudConsent, PrivacyMode } from '@ritual/shared-contracts';

export type UpdateManifest = {
  body?: string | null;
  date?: string | null;
  version?: string | null;
};

export type DesktopRuntimeInfo = {
  version: string;
  environment: string;
  channel: 'production' | 'qa' | 'development';
  productName: string;
  bundleId: string;
  callbackScheme: string;
  buildSha: string;
  handoffProtocol: string;
  capabilities: string[];
  updaterActive: boolean;
  frontendReady: boolean;
  target?: string | null;
  pendingUpdate?: UpdateManifest | null;
};

export type DesktopAuthHandoffStart = {
  handoffId: string;
  nonceChallenge: string;
  channel: 'production' | 'qa' | 'development';
  protocol: '2';
  expiresAtMs: number;
  appVersion: string;
  buildSha: string;
  productName: string;
  bundleId: string;
  callbackScheme: string;
  target?: string | null;
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
  lastTursoErrorCode?: string | null;
};

export type DesktopPrivacyRuntimeState = {
  mode: PrivacyMode;
  consents: CloudConsent[];
  updatedAt: string;
};

export type DesktopComputerSyncStage =
  | 'idle'
  | 'materializing'
  | 'local_ready'
  | 'obtaining_config'
  | 'uploading'
  | 'verifying'
  | 'downloading'
  | 'projecting'
  | 'synced'
  | 'privacy_blocked'
  | 'failed';

export type DesktopComputerSyncRuntimeState = {
  stage: DesktopComputerSyncStage;
  pendingRollups: number;
  pendingRawRows: number;
  uploadedRollups: number;
  supersededRawRows: number;
  localWatermarkMs?: number | null;
  remoteWatermarkMs?: number | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastUpdatedAtMs?: number | null;
};

export type ComputerActivitySyncOutcome =
  | 'local_refreshed'
  | 'cloud_synced'
  | 'cloud_pending'
  | 'privacy_blocked'
  | 'failed';

export type ComputerActivitySyncResult = {
  outcome: ComputerActivitySyncOutcome;
  stage: DesktopComputerSyncStage;
  uploadedRollups: number;
  supersededRawRows: number;
  pendingRollups: number;
  pendingRawRows: number;
  localWatermarkMs?: number | null;
  remoteWatermarkMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type DesktopLoginPromptState =
  | 'not_required'
  | 'required'
  | 'accepted'
  | 'dismissed';

export type DesktopResidentRuntimeState = {
  backgroundLaunch: boolean;
  trackingEnabled: boolean;
  watcherRunning: boolean;
  launchAtLogin: boolean;
  launchAtLoginRegistered: boolean;
  showMenuBar: boolean;
  windowVisible: boolean;
  loginPromptState: DesktopLoginPromptState;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

export type DesktopWatcherConfig = {
  device_id: string;
  user_id: string;
  poll_interval_ms: number;
  title_mode: 'off' | 'full' | 'truncate' | 'hash';
  truncate_length: number;
  excluded_bundle_ids: string[];
  afk_timeout_seconds?: number;
  url_mode?: string;
  track_incognito?: boolean;
  browser_heartbeat_port?: number;
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
  privacy: DesktopPrivacyRuntimeState;
  computerSync: DesktopComputerSyncRuntimeState;
  database: DesktopDatabaseRuntimeState;
  watcher: DesktopWatcherRuntimeState;
  process?: DesktopProcessMetrics;
};

export type DesktopDiagnostics = {
  schemaVersion: 1;
  runtime: DesktopRuntimeInfo;
  process: {
    pid: number;
    processName: string;
    executablePath: string;
  };
  backendBase?: string | null;
  nativeGatewayStatus: string;
  ipcStatus: string;
  appDataDirectory: string;
  callbackSchemeOwner?: string | null;
  window: {
    exists: boolean;
    visible: boolean;
    focused: boolean;
    ignoresMouseEvents?: boolean | null;
    windowLevel?: number | null;
    hitTestable: boolean;
    mainContentOpaque: boolean;
  };
  state: DesktopRuntimeState;
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

export async function desktopBeginAuthHandoff(): Promise<DesktopAuthHandoffStart | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<DesktopAuthHandoffStart>('desktop_begin_auth_handoff');
}

export async function desktopCompleteAuthHandoff(handoffId: string): Promise<void> {
  await invokeDesktopCommand('desktop_complete_auth_handoff', { handoffId });
}

export async function desktopPollAuthHandoff(): Promise<DesktopNativeAuthSession> {
  return invokeDesktopCommand<DesktopNativeAuthSession>('desktop_poll_auth_handoff');
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

export async function getDesktopDiagnostics(): Promise<DesktopDiagnostics | null> {
  if (!isDesktopTauriRuntime()) return null;
  try {
    return await invokeDesktopCommand<DesktopDiagnostics>('get_desktop_diagnostics');
  } catch (error) {
    console.warn('Desktop diagnostics unavailable:', error);
    return null;
  }
}

export type DesktopNativeAuthSession = {
  token: string;
  userId: string;
  sessionId: string;
  profile: unknown;
};

export async function desktopGetAuthToken(input?: {
  refresh?: boolean | null;
}): Promise<DesktopNativeAuthSession | null> {
  if (!isDesktopTauriRuntime()) return null;

  try {
    const result = await invokeDesktopCommand('desktop_get_auth_token', {
      refresh: input?.refresh ?? null,
    });
    const session = result as DesktopNativeAuthSession | null;
    if (!session || typeof session !== 'object') return null;
    return {
      token: typeof session.token === 'string' ? session.token : '',
      userId: typeof session.userId === 'string' ? session.userId : '',
      sessionId: typeof session.sessionId === 'string' ? session.sessionId : '',
      profile: session.profile ?? null,
    };
  } catch (error) {
    console.warn('Desktop native auth session unavailable:', error);
    throw error;
  }
}

export async function desktopSetAuthToken(input: {
  token: string;
  userId?: string | null;
  backendBase?: string | null;
  sessionId?: string | null;
  profile?: unknown | null;
}): Promise<DesktopRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;

  try {
    const result = await invokeDesktopCommand<DesktopRuntimeState>('desktop_set_auth_token', {
      token: input.token,
      userId: input.userId ?? null,
      backendBase: input.backendBase ?? null,
      sessionId: input.sessionId ?? null,
      profile: input.profile ?? null,
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

export async function desktopSetPrivacyState(input: {
  mode: PrivacyMode;
  consents: Partial<Record<CloudConsent, boolean>>;
  updatedAt: string;
}): Promise<DesktopRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<DesktopRuntimeState>('desktop_set_privacy_state', {
    state: input,
  });
}

export async function syncComputerActivityNow(): Promise<ComputerActivitySyncResult | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<ComputerActivitySyncResult>('sync_computer_activity_now');
}

export async function getDesktopResidentRuntimeState(): Promise<DesktopResidentRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<DesktopResidentRuntimeState>('desktop_get_resident_runtime_state');
}

export async function desktopSetComputerTracking(input: {
  enabled: boolean;
  config?: DesktopWatcherConfig | null;
}): Promise<DesktopResidentRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<DesktopResidentRuntimeState>('desktop_set_computer_tracking', {
    input: {
      enabled: input.enabled,
      config: input.config ?? null,
    },
  });
}

export async function desktopSetLaunchAtLogin(
  enabled: boolean,
): Promise<DesktopResidentRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<DesktopResidentRuntimeState>('desktop_set_launch_at_login', { enabled });
}

export async function desktopSetMenuBarVisibility(
  visible: boolean,
): Promise<DesktopResidentRuntimeState | null> {
  if (!isDesktopTauriRuntime()) return null;
  return invokeDesktopCommand<DesktopResidentRuntimeState>('desktop_set_menu_bar_visibility', { visible });
}

export async function desktopQuitCompletely(): Promise<void> {
  if (!isDesktopTauriRuntime()) return;
  await invokeDesktopCommand('desktop_quit_completely');
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
