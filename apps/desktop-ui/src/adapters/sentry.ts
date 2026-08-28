const noop = () => {};
const asyncNoop = async () => undefined;

export const captureMessage = noop;
export const captureException = noop;
export const addBreadcrumb = noop;
export const setTag = noop;
export const setUser = noop;
export const init = noop;
export const flush = asyncNoop;
export const captureRouterTransitionStart = noop;
export const replayIntegration = () => ({});
export const logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  fatal: noop,
};

export function startSpan<T>(_opts: unknown, callback?: () => T): T | undefined {
  return callback ? callback() : undefined;
}

export function withSentryConfig<T>(config: T): T {
  return config;
}

const Sentry = {
  captureMessage,
  captureException,
  addBreadcrumb,
  setTag,
  setUser,
  init,
  flush,
  startSpan,
  captureRouterTransitionStart,
  replayIntegration,
  logger,
};

export default Sentry;
