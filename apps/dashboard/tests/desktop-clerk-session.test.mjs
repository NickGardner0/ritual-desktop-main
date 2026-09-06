import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function unwrapClerkSessionList(listed) {
  if (Array.isArray(listed)) return listed;
  if (listed && typeof listed === 'object' && Array.isArray(listed.data)) return listed.data;
  return [];
}

function sessionCreatedAtMs(session) {
  const value = session.createdAt;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  return 0;
}

function selectActiveClerkSessionId(sessions) {
  const usable = sessions.filter((session) => {
    if (!String(session.id || '').trim()) return false;
    const status = (session.status || 'active').toLowerCase();
    return status === 'active';
  });
  usable.sort((left, right) => sessionCreatedAtMs(right) - sessionCreatedAtMs(left));
  return String(usable[0]?.id || '').trim();
}

test('desktop Clerk session helpers pick the newest active session', () => {
  assert.deepEqual(unwrapClerkSessionList({ data: [{ id: 'sess_a' }] }), [{ id: 'sess_a' }]);
  assert.equal(
    selectActiveClerkSessionId([
      { id: 'sess_old', status: 'active', createdAt: 1 },
      { id: 'sess_new', status: 'active', createdAt: 2 },
      { id: 'sess_dead', status: 'ended', createdAt: 9 },
    ]),
    'sess_new',
  );
  assert.equal(selectActiveClerkSessionId([{ id: 'sess_dead', status: 'revoked' }]), '');
});

test('mintDesktopClerkSession source uses the existing OAuth session, not createSession', async () => {
  const source = await readFile('apps/dashboard/lib/server/desktop-clerk-session.ts', 'utf8');
  assert.match(source, /export function unwrapClerkSessionList/);
  assert.match(source, /export function selectActiveClerkSessionId/);
  assert.match(source, /getSessionList!\(\{ userId, status: 'active'/);
  assert.doesNotMatch(source, /createSession!/);
  assert.match(source, /Production Clerk instances cannot createSession/);
});
