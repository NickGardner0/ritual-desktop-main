const PHASES = new Set([
  'up_to_date',
  'available',
  'downloading',
  'installing',
  'relaunching',
  'error',
]);

export function decodeDesktopUpdateEvent(payload = {}) {
  if (payload.version === 2 && PHASES.has(payload.phase)) {
    return {
      phase: payload.phase,
      contentLength: Number(payload.contentLength || 0),
      downloaded: Number(payload.downloaded || 0),
      percentage: Math.max(0, Math.min(100, Number(payload.percentage || 0))),
      message: typeof payload.message === 'string' ? payload.message : null,
    };
  }
  const status = String(payload.status || '').toUpperCase();
  const legacyPhase = {
    UPTODATE: 'up_to_date',
    AVAILABLE: 'available',
    PENDING: 'downloading',
    DOWNLOADING: 'downloading',
    INSTALLING: 'installing',
    DONE: 'relaunching',
    ERROR: 'error',
  }[status];
  if (!legacyPhase) return null;
  return {
    phase: legacyPhase,
    contentLength: Number(payload.contentLength || 0),
    downloaded: Number(payload.downloaded || 0),
    percentage: Math.max(0, Math.min(100, Number(payload.percentage || 0))),
    message: typeof payload.error === 'string' ? payload.error : null,
  };
}

export function reduceDesktopUpdateEvent(snapshot, payload) {
  const event = decodeDesktopUpdateEvent(payload);
  if (!event) return snapshot;
  if (event.phase === 'up_to_date') {
    return { ...snapshot, manifest: null, phase: 'idle', percentage: 0, contentLength: 0, downloaded: 0, error: null };
  }
  if (event.phase === 'available') {
    return { ...snapshot, phase: 'available', percentage: 0, contentLength: 0, downloaded: 0, error: null };
  }
  if (event.phase === 'downloading') {
    return { ...snapshot, phase: 'downloading', contentLength: event.contentLength, downloaded: event.downloaded, percentage: event.percentage, error: null };
  }
  if (event.phase === 'installing') {
    return { ...snapshot, phase: 'installing', percentage: 100, contentLength: 0, downloaded: 0, error: null };
  }
  if (event.phase === 'relaunching') {
    return { ...snapshot, phase: 'relaunching', percentage: 100, contentLength: 0, downloaded: 0, error: null };
  }
  return { ...snapshot, phase: 'error', percentage: 0, contentLength: 0, downloaded: 0, error: event.message || 'Update failed. Please try again.' };
}
