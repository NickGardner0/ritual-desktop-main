import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('browser callback carries an opaque handoff id but no verifier or Clerk ticket', async () => {
  const bridge = await readFile('apps/dashboard/app/auth/desktop-oauth-bridge/page.tsx', 'utf8');
  const buildDeepLink = bridge.slice(
    bridge.indexOf('function buildDeepLink'),
    bridge.indexOf('async function createDesktopSignInHandoff'),
  );
  assert.match(buildDeepLink, /handoff_id: identity\.handoffId/);
  assert.doesNotMatch(buildDeepLink, /ticket|nonce:/);
});

test('native verifier is represented in the browser only by its SHA-256 challenge', async () => {
  const launcher = await readFile('apps/dashboard/components/clerk-oauth-handler.tsx', 'utf8');
  const origin = await readFile('apps/dashboard/lib/desktop-auth-origin.ts', 'utf8');
  const native = await readFile(
    'apps/desktop/src-tauri/src/desktop_runtime/auth_handoff.rs',
    'utf8',
  );
  assert.match(launcher, /buildDesktopOAuthStartUrl/);
  assert.doesNotMatch(launcher, /window\.location\.origin/);
  assert.match(origin, /nonce_challenge', handoff\.nonceChallenge/);
  assert.doesNotMatch(origin, /searchParams\.set\('nonce'/);
  assert.match(origin, /desktop\.ritualdb\.com/);
  assert.match(native, /Sha256::digest\(nonce\.as_bytes\(\)\)/);
  assert.match(native, /append_pair\("nonce", &pending\.nonce\)/);
});

test('Clerk ticket is minted only after the durable one-time consume succeeds', async () => {
  const route = await readFile(
    'apps/dashboard/app/api/auth/desktop-sign-in-token/route.ts',
    'utf8',
  );
  const patchHandler = route.slice(route.indexOf('export async function PATCH'));
  const consumeAt = patchHandler.indexOf('/consume');
  const ticketAt = patchHandler.indexOf('createSignInToken');
  assert.ok(consumeAt >= 0 && ticketAt > consumeAt);
  const postHandler = route.slice(
    route.indexOf('export async function POST'),
    route.indexOf('export async function GET'),
  );
  assert.doesNotMatch(postHandler, /createSignInToken/);
});

test('local SPA consumes the hosted handoff API, never a relative Next route', async () => {
  const origin = await readFile('apps/dashboard/lib/desktop-auth-origin.ts', 'utf8');
  const handoff = await readFile('apps/dashboard/lib/desktop-auth-handoff.ts', 'utf8');
  const native = await readFile(
    'apps/desktop/src-tauri/src/desktop_runtime/auth_handoff.rs',
    'utf8',
  );
  const nextConfig = await readFile('apps/dashboard/next.config.mjs', 'utf8');
  assert.match(origin, /export function getDesktopAuthHandoffApiUrl/);
  assert.match(handoff, /desktop_consume_auth_handoff/);
  assert.match(handoff, /getDesktopAuthHandoffApiUrl\(\)/);
  assert.doesNotMatch(handoff, /fetch\('\/api\/auth\/desktop-sign-in-token'/);
  assert.match(native, /fn desktop_consume_auth_handoff/);
  assert.match(native, /reqwest::Method::PATCH/);
  assert.match(native, /\/api\/auth\/desktop-sign-in-token/);
  assert.match(nextConfig, /PATCH/);
  assert.match(nextConfig, /https:\/\/tauri\.localhost/);
});

test('local SPA hands Clerk ticket activation to the hosted origin', async () => {
  const origin = await readFile('apps/dashboard/lib/desktop-auth-origin.ts', 'utf8');
  const bridge = await readFile(
    'apps/dashboard/components/desktop-auth-deep-link-bridge.tsx',
    'utf8',
  );
  const callback = await readFile('apps/dashboard/app/auth/callback/page.tsx', 'utf8');
  const main = await readFile('apps/desktop/src-tauri/src/main.rs', 'utf8');
  const nativeWidget = await readFile(
    'apps/desktop/src-tauri/src/native_widget.rs',
    'utf8',
  );
  assert.match(origin, /export function shouldCompleteDesktopAuthOnHostedOrigin/);
  assert.match(origin, /export function buildDesktopHostedAuthCallbackUrl/);
  assert.match(bridge, /desktop\.auth_ticket\.hosted_handoff/);
  assert.match(bridge, /window\.location\.replace\(hostedCallbackUrl\)/);
  assert.match(callback, /shouldCompleteDesktopAuthOnHostedOrigin\(\)/);
  assert.match(callback, /buildDesktopHostedAuthCallbackUrl/);
  assert.match(nativeWidget, /fn has_persisted_auth_token/);
  assert.match(main, /has_persisted_auth_token\(\)/);
  assert.match(main, /WebviewUrl::External\(hosted\)/);
});
