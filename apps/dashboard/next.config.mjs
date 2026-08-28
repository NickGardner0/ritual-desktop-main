import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');

const corsAllowOrigin = (() => {
  const raw =
    process.env.CORS_ALLOW_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    'https://tauri.localhost';
  if (raw === 'tauri://localhost' || raw === 'http://tauri.localhost') {
    return 'https://tauri.localhost';
  }
  return raw;
})();

const primarySentryProject =
  process.env.SENTRY_SOURCEMAP_PROJECT ||
  process.env.SENTRY_PROJECT ||
  'javascript-nextjs';

const sentrySourcemapProjects = [
  primarySentryProject,
  ...(process.env.SENTRY_ADDITIONAL_SOURCEMAP_PROJECTS || '')
    .split(',')
    .map((project) => project.trim())
    .filter(Boolean),
].filter((project, index, projects) => projects.indexOf(project) === index);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable strict mode for better development experience and catching potential issues
  reactStrictMode: true,
  // Hide Next.js floating dev indicator launcher in development.
  devIndicators: false,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  
  experimental: {
    optimizePackageImports: [
      'recharts', 
      '@radix-ui/react-icons',
      'lucide-react',
      'date-fns',
      'react-day-picker',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      '@tanstack/react-query',
      'framer-motion',
      'ai',
      '@ai-sdk/react',
      '@clerk/nextjs',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-dialog',
      '@radix-ui/react-slot',
    ],
  },

  transpilePackages: ['@ritual/chat-runtime', '@ritual/shared-contracts'],

  serverExternalPackages: ['pino'],

  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@ritual/chat-runtime$': path.resolve(
        repoRoot,
        'packages/chat-runtime/dist/index.js',
      ),
      '@ritual/chat-runtime/executors': path.resolve(
        repoRoot,
        'packages/chat-runtime/dist/executors/index.js',
      ),
      '@ritual/chat-runtime/narrative': path.resolve(
        repoRoot,
        'packages/chat-runtime/dist/narrative/index.js',
      ),
      '@ritual/chat-runtime/weekly-overview-utils': path.resolve(
        repoRoot,
        'packages/chat-runtime/dist/weekly-overview-utils.js',
      ),
      '@ritual/chat-runtime/stream-response': path.resolve(
        repoRoot,
        'packages/chat-runtime/dist/stream-response.js',
      ),
      '@ritual/shared-contracts$': path.resolve(
        repoRoot,
        'packages/shared-contracts/dist/index.js',
      ),
    };

    return config;
  },
  
  // Add headers for Tauri webview compatibility
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: corsAllowOrigin,
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
        ],
      },
    ];
  },
}

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: process.env.SENTRY_ORG || "nick-gardner",
  project: primarySentryProject,

  // Sentry CLI is very noisy with Next.js debug-ID uploads because it prints a
  // warning for every generated JS artifact that does not have an adjacent map.
  // Keep the upload active and still fail the build on real upload errors, but
  // suppress successful CLI output in CI/Vercel logs.
  silent: true,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  sourcemaps: {
    ignore: [
      // Preserve the Sentry/Next defaults when overriding the ignore list.
      '**/static/chunks/main-*',
      '**/static/chunks/framework-*',
      '**/static/chunks/framework.*',
      '**/static/chunks/polyfills-*',
      '**/static/chunks/webpack-*',
      // Next.js emits generated UUID-named chunks and client reference
      // manifests without adjacent source maps. They do not improve stack
      // trace quality and make Vercel logs noisy during Sentry uploads.
      '**/????????-????-????-????-????????????-*.js',
      '**/*_client-reference-manifest.js',
    ],
  },

  reactComponentAnnotation: {
    enabled: process.env.NODE_ENV === 'production',
  },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Hides source maps from generated client bundles
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,

  // The underlying Sentry bundler plugin supports uploading one build's debug
  // files to multiple projects. Use that instead of a second broad CLI scan of
  // `.next`.
  unstable_sentryWebpackPluginOptions: {
    project: sentrySourcemapProjects,
  },
};

// Skip Sentry build plugin in development — it adds compilation overhead
// without providing meaningful value during local dev
const finalConfig = process.env.NODE_ENV === 'production'
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

export default withBundleAnalyzer(finalConfig);
