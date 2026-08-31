import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bindHostedOrigins, probeLocalChatSidecar, type RitualDesktopWindow } from './desktop-origins';

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

function main() {
  const w = window as RitualDesktopWindow;
  bindHostedOrigins(w, import.meta.env);
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <DesktopErrorBoundary>
      <App />
    </DesktopErrorBoundary>,
  );
  void probeLocalChatSidecar(w);
}

main();
