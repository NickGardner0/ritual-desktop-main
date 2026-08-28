/**
 * Maps Ritual action profiles (observe | draft | organize | act) onto chat tools.
 * Once / Always / Deny are UI decisions persisted per (tool, scope).
 */

export const ACTION_PROFILES = ['observe', 'draft', 'organize', 'act'] as const;
export type ActionProfile = (typeof ACTION_PROFILES)[number];

export const PERMISSION_DECISIONS = ['allow', 'deny', 'ask'] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export const USER_PERMISSION_CHOICES = ['once', 'always', 'deny'] as const;
export type UserPermissionChoice = (typeof USER_PERMISSION_CHOICES)[number];

const WRITE_TOOLS = new Set([
  'logHabit',
  'createHabit',
  'updateSmsPreferences',
]);

const ASK_IN_ACT = new Set([
  'updateSmsPreferences',
]);

const alwaysByToken = new Map<string, Set<string>>();
const deniedByToken = new Map<string, Set<string>>();
const pendingById = new Map<string, {
  resolve: (choice: UserPermissionChoice) => void;
}>();

export function isActionProfile(value: unknown): value is ActionProfile {
  return typeof value === 'string' && (ACTION_PROFILES as readonly string[]).includes(value);
}

export function permissionScopeKey(toolName: string, extra = ''): string {
  return extra ? `${toolName}:${extra}` : toolName;
}

export function rememberAlways(token: string, scope: string): void {
  const scopes = alwaysByToken.get(token) || new Set<string>();
  scopes.add(scope);
  alwaysByToken.set(token, scopes);
}

export function rememberDenied(token: string, scope: string): void {
  const scopes = deniedByToken.get(token) || new Set<string>();
  scopes.add(scope);
  alwaysByToken.get(token)?.delete(scope);
  deniedByToken.set(token, scopes);
}

export function alwaysScopesForToken(token: string, extra: string[] = []): Set<string> {
  const scopes = new Set(alwaysByToken.get(token) || []);
  for (const item of extra) {
    if (item) scopes.add(item);
  }
  return scopes;
}

export function resolveToolPermission(input: {
  toolName: string;
  profile: ActionProfile;
  alwaysAllowed?: ReadonlySet<string>;
  denied?: ReadonlySet<string>;
  scope?: string;
}): PermissionDecision {
  const scope = input.scope || permissionScopeKey(input.toolName);
  if (input.denied?.has(scope)) return 'deny';
  if (input.alwaysAllowed?.has(scope)) return 'allow';

  const isWrite = WRITE_TOOLS.has(input.toolName);
  if (!isWrite) return 'allow';

  if (input.profile === 'observe' || input.profile === 'draft' || input.profile === 'organize') {
    return input.profile === 'draft' ? 'deny' : 'deny';
  }

  if (ASK_IN_ACT.has(input.toolName)) return 'ask';
  return 'allow';
}

export function draftToolResult(toolName: string, args: unknown): string {
  return JSON.stringify({
    success: true,
    draft: true,
    persisted: false,
    tool: toolName,
    proposed: args,
    message: 'Drafted only. Switch to act (or approve Once/Always) to persist this write.',
  });
}

export function deniedToolResult(toolName: string, profile: ActionProfile): string {
  return JSON.stringify({
    success: false,
    denied: true,
    tool: toolName,
    profile,
    message: `Writes are not allowed in ${profile} profile.`,
  });
}

export function waitForPermission(
  id: string,
  timeoutMs = 60_000,
): Promise<UserPermissionChoice> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingById.delete(id);
      resolve('deny');
    }, timeoutMs);
    pendingById.set(id, {
      resolve: (choice) => {
        clearTimeout(timer);
        pendingById.delete(id);
        resolve(choice);
      },
    });
  });
}

export function submitPermissionDecision(id: string, decision: UserPermissionChoice): boolean {
  const pending = pendingById.get(id);
  if (!pending) return false;
  pending.resolve(decision);
  return true;
}

export function isUserPermissionChoice(value: unknown): value is UserPermissionChoice {
  return typeof value === 'string' && (USER_PERMISSION_CHOICES as readonly string[]).includes(value);
}

export function resetPermissionStateForTests(): void {
  alwaysByToken.clear();
  deniedByToken.clear();
  pendingById.clear();
}
