/**
 * In-memory SessionStore for tests and development.
 */

import type {
  Session,
  SessionItem,
  SessionStore,
} from './types.js';

interface StoredSession {
  session: Session;
  items: SessionItem[];
  nextSeq: number;
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, StoredSession>();

  async getOrCreateSession(sessionId: string, userId: string): Promise<Session> {
    let stored = this.sessions.get(sessionId);
    if (!stored) {
      const session: Session = {
        id: sessionId,
        user_id: userId,
        run_status: null,
        run_heartbeat: null,
        created_at: new Date().toISOString(),
        always_allow_scopes: [],
      };
      stored = { session, items: [], nextSeq: 1 };
      this.sessions.set(sessionId, stored);
    }
    return { ...stored.session };
  }

  async tryLock(sessionId: string): Promise<boolean> {
    const stored = this.sessions.get(sessionId);
    if (!stored) return false;
    if (stored.session.run_status === 'running') {
      // Check heartbeat expiry (2 min)
      if (stored.session.run_heartbeat) {
        const elapsed = Date.now() - new Date(stored.session.run_heartbeat).getTime();
        if (elapsed < 120_000) return false;
      } else {
        return false;
      }
    }
    stored.session.run_status = 'running';
    stored.session.run_heartbeat = new Date().toISOString();
    return true;
  }

  async unlock(sessionId: string): Promise<void> {
    const stored = this.sessions.get(sessionId);
    if (stored) {
      stored.session.run_status = null;
      stored.session.run_heartbeat = null;
    }
  }

  async heartbeat(sessionId: string): Promise<void> {
    const stored = this.sessions.get(sessionId);
    if (stored) {
      stored.session.run_heartbeat = new Date().toISOString();
    }
  }

  async appendItem(
    sessionId: string,
    item: Omit<SessionItem, 'seq' | 'created_at' | 'session_id'>,
  ): Promise<number> {
    const stored = this.sessions.get(sessionId);
    if (!stored) throw new Error(`Session not found: ${sessionId}`);
    const seq = stored.nextSeq++;
    const full = {
      ...item,
      session_id: sessionId,
      seq,
      created_at: new Date().toISOString(),
    } as SessionItem;
    stored.items.push(full);
    return seq;
  }

  async getItems(sessionId: string, afterSeq?: number): Promise<SessionItem[]> {
    const stored = this.sessions.get(sessionId);
    if (!stored) return [];
    if (afterSeq != null) {
      return stored.items.filter((i) => i.seq > afterSeq);
    }
    return [...stored.items];
  }

  async hasCommandId(sessionId: string, commandId: string): Promise<boolean> {
    const stored = this.sessions.get(sessionId);
    if (!stored) return false;
    return stored.items.some(
      (i) => i.type === 'user' && i.payload.command_id === commandId,
    );
  }

  async addAlwaysAllowScope(sessionId: string, scope: string): Promise<void> {
    const stored = this.sessions.get(sessionId);
    if (stored && !stored.session.always_allow_scopes.includes(scope)) {
      stored.session.always_allow_scopes.push(scope);
    }
  }

  async getAlwaysAllowScopes(sessionId: string): Promise<string[]> {
    const stored = this.sessions.get(sessionId);
    return stored ? [...stored.session.always_allow_scopes] : [];
  }
}
