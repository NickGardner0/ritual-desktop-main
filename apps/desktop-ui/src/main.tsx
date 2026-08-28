import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

class DesktopErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ritual desktop UI crashed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        style={{
          minHeight: '100vh',
          padding: 48,
          background: '#fefefe',
          color: '#111111',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <p style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a7a7a' }}>
          Ritual
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: '12px 0' }}>
          The window opened, but the UI failed to load.
        </h1>
        <p style={{ color: '#666666', maxWidth: 520 }}>{this.state.error.message}</p>
      </main>
    );
  }
}

type RitualWindow = Window & {
  __RITUAL_API_ORIGIN__?: string;
  __RITUAL_CHAT_ORIGIN__?: string;
  __RITUAL_HOSTED_ORIGIN__?: string;
};

async function bootstrapOrigins() {
  const w = window as RitualWindow;
  w.__RITUAL_API_ORIGIN__ =
    (import.meta.env.VITE_PYTHON_API_URL as string | undefined)
    || (import.meta.env.NEXT_PUBLIC_PYTHON_API_URL as string | undefined)
    || 'https://backend-api-production-a37e.up.railway.app';
  w.__RITUAL_HOSTED_ORIGIN__ =
    (import.meta.env.VITE_HOSTED_ORIGIN as string | undefined)
    || 'https://desktop.ritualdb.com';
  try {
    const health = await fetch('http://127.0.0.1:8787/health', {
      signal: AbortSignal.timeout(300),
    });
    if (health.ok) {
      w.__RITUAL_CHAT_ORIGIN__ = 'http://127.0.0.1:8787';
      return;
    }
  } catch {
    // Fall through to hosted chat API. UI still stays local.
  }
}

async function main() {
  await bootstrapOrigins();
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <DesktopErrorBoundary>
      <App />
    </DesktopErrorBoundary>,
  );
}

void main();
