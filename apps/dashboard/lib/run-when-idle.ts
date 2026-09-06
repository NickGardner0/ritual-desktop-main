export function runWhenIdle(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const idle = typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback.bind(window)
    : (next: () => void) => window.setTimeout(next, 1);
  const cancel = typeof window.cancelIdleCallback === 'function'
    ? window.cancelIdleCallback.bind(window)
    : (handle: number) => window.clearTimeout(handle);
  const handle = idle(() => callback());
  return () => cancel(handle);
}
