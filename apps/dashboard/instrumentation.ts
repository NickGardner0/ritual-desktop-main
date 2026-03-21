export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

export const onRequestError = async (err: unknown, request: {
  path: string;
}) => {
  await import('@sentry/nextjs').then((Sentry) => {
    Sentry.captureException(err, {
      contexts: {
        request: {
          url: request.path,
        },
      },
    });
  });
};
