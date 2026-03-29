import { invoke } from '@tauri-apps/api/tauri';
import { shell } from '@tauri-apps/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const RETRY_COPY = {
  idle: 'Preparing Ritual…',
  checking: 'Checking the hosted desktop app…',
  offline: 'Ritual needs an internet connection to load the hosted app.',
  failed: 'The hosted Ritual app did not respond. You can retry or open it in your browser.',
};

const FALLBACK_REVEAL_DELAY_MS = 6500;

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function DesktopShellApp() {
  const [bootstrapConfig, setBootstrapConfig] = useState(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [showFallbackUi, setShowFallbackUi] = useState(false);
  const hasRequestedRevealRef = useRef(false);

  const revealFallbackUi = useCallback(async () => {
    setShowFallbackUi(true);
    if (hasRequestedRevealRef.current) return;
    hasRequestedRevealRef.current = true;
    try {
      await invoke('show_main_window');
    } catch (error) {
      console.error('Failed to show Ritual desktop shell fallback UI:', error);
    }
  }, []);

  const loadHostedApp = useCallback(async () => {
    setState('checking');
    setError('');

    try {
      const config =
        bootstrapConfig ??
        (await invoke('get_desktop_shell_bootstrap_config'));

      if (!bootstrapConfig) {
        setBootstrapConfig(config);
      }

      if (navigator.onLine === false) {
        setState('offline');
        void revealFallbackUi();
        return;
      }

      const reachable = await invoke('check_desktop_hosted_app_reachable', {
        url: config.bootstrapUrl,
      });

      if (!reachable) {
        setState('failed');
        void revealFallbackUi();
        return;
      }

      window.location.replace(config.bootstrapUrl);
    } catch (loadError) {
      console.error('Failed to bootstrap Ritual desktop shell:', loadError);
      setError(formatError(loadError));
      setState('failed');
      void revealFallbackUi();
    }
  }, [bootstrapConfig, revealFallbackUi]);

  useEffect(() => {
    let mounted = true;

    invoke('get_desktop_shell_bootstrap_config')
      .then((config) => {
        if (!mounted) return;
        setBootstrapConfig(config);
      })
      .catch((configError) => {
        console.error('Failed to load Ritual desktop shell config:', configError);
        if (!mounted) return;
        setError(formatError(configError));
        setState('failed');
        void revealFallbackUi();
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!bootstrapConfig) return;
    void loadHostedApp();
  }, [bootstrapConfig, loadHostedApp]);

  useEffect(() => {
    if (state !== 'idle' && state !== 'checking') {
      return;
    }

    const timer = window.setTimeout(() => {
      void revealFallbackUi();
    }, FALLBACK_REVEAL_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [revealFallbackUi, state]);

  useEffect(() => {
    const handleOnline = () => {
      if (state === 'offline') {
        void loadHostedApp();
      }
    };
    const handleOffline = () => {
      setState('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadHostedApp, state]);

  const statusCopy = useMemo(() => RETRY_COPY[state] ?? RETRY_COPY.idle, [state]);

  const handleOpenInBrowser = useCallback(async () => {
    if (!bootstrapConfig) return;
    try {
      await shell.open(bootstrapConfig.bootstrapUrl);
    } catch (shellError) {
      console.error('Failed to open Ritual in browser:', shellError);
      window.open(bootstrapConfig.bootstrapUrl, '_blank', 'noopener,noreferrer');
    }
  }, [bootstrapConfig]);

  if (!showFallbackUi) {
    return <main className="shell shell--hidden" aria-hidden="true" />;
  }

  return (
    <main className="shell">
      <div className="shell__card">
        <div className="shell__badge">Ritual</div>
        <h1 className="shell__title">Launching Ritual</h1>
        <p className="shell__body">{statusCopy}</p>
        {error ? <p className="shell__error">{error}</p> : null}
        <div className="shell__actions">
          <button
            type="button"
            className="shell__button shell__button--primary"
            onClick={() => void loadHostedApp()}
            disabled={!bootstrapConfig || state === 'checking'}
          >
            {state === 'checking' ? 'Checking…' : 'Retry'}
          </button>
          <button
            type="button"
            className="shell__button"
            onClick={() => void handleOpenInBrowser()}
            disabled={!bootstrapConfig}
          >
            Open in browser
          </button>
        </div>
        <p className="shell__footnote">
          Hosted UI: {bootstrapConfig?.appOrigin ?? 'Loading…'}
        </p>
      </div>
    </main>
  );
}
