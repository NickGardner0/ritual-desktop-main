import { createRoot } from 'react-dom/client';
import { App } from './App';

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
  createRoot(root).render(<App />);
}

void main();
