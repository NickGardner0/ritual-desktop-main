import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');

const corsAllowOrigin =
  process.env.CORS_ALLOW_ORIGIN ||
  process.env.NEXT_PUBLIC_APP_ORIGIN ||
  'tauri://localhost';

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

  transpilePackages: ['@ritual/chat-runtime'],

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
            value: 'GET, POST, PUT, DELETE, OPTIONS',
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

  org: "nick-gardner",
  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

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
};

// Skip Sentry build plugin in development — it adds compilation overhead
// without providing meaningful value during local dev
const finalConfig = process.env.NODE_ENV === 'production'
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

export default withBundleAnalyzer(finalConfig);
