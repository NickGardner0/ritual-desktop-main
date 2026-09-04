import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(root, '../dashboard');
const adapters = path.resolve(root, 'src/adapters');
const emptyModule = path.join(adapters, 'empty.ts');

function stubUnknownNextImports(): Plugin {
  const aliased = new Set([
    'next/navigation',
    'next/link',
    'next/dynamic',
    'next/image',
    'next/headers',
    'next/server',
    'next/cache',
    'next/script',
    'next/font/google',
  ]);
  return {
    name: 'ritual-stub-unknown-next',
    enforce: 'pre',
    resolveId(source) {
      const id = source.split('?')[0];
      if (id === 'client-only') {
        return emptyModule;
      }
      if ((id === 'next' || id.startsWith('next/')) && !aliased.has(id)) {
        return emptyModule;
      }
      return null;
    },
  };
}

const PRODUCTION_PUBLIC_ENV: Record<string, string> = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsucml0dWFsZGIuY29tJA',
  NEXT_PUBLIC_PYTHON_API_URL: 'https://backend-api-production-a37e.up.railway.app',
  VITE_HOSTED_ORIGIN: 'https://desktop.ritualdb.com',
};

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => Boolean(value && value.trim()))?.trim();
}

function firstClerkPublishableKey(...values: Array<string | undefined>) {
  return values.find((value) => /^pk_(live|test)_/.test(value?.trim() || ''))?.trim();
}

export default defineConfig(({ mode }) => {
  const fileEnv = {
    ...loadEnv(mode, dashboard, ''),
    ...loadEnv(mode, root, ''),
  };

  const processEnv: Record<string, string> = {
    NODE_ENV: mode === 'production' ? 'production' : 'development',
  };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key === 'PYTHON_API_URL') {
      processEnv[key] = value;
    }
  }

  processEnv.NEXT_PUBLIC_PYTHON_API_URL = firstNonEmpty(
    process.env.NEXT_PUBLIC_PYTHON_API_URL,
    fileEnv.NEXT_PUBLIC_PYTHON_API_URL,
    PRODUCTION_PUBLIC_ENV.NEXT_PUBLIC_PYTHON_API_URL,
  ) || '';
  processEnv.VITE_HOSTED_ORIGIN = firstNonEmpty(
    process.env.VITE_HOSTED_ORIGIN,
    fileEnv.VITE_HOSTED_ORIGIN,
    PRODUCTION_PUBLIC_ENV.VITE_HOSTED_ORIGIN,
  ) || '';
  processEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = firstClerkPublishableKey(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    fileEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    PRODUCTION_PUBLIC_ENV.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  ) || '';

  if (mode === 'production' && !processEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    throw new Error(
      'desktop-ui production build requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_live_ or pk_test_).',
    );
  }

  return {
    base: './',
    appType: 'spa',
    plugins: [stubUnknownNextImports(), react()],
    envDir: dashboard,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      'process.env': JSON.stringify(processEnv),
      'import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify(
        processEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
      ),
      'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(
        processEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
      ),
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        { find: '@/lib/desktop-session', replacement: path.join(adapters, 'clerk.tsx') },
        { find: '@/lib/app-navigation', replacement: path.join(adapters, 'next-navigation.ts') },
        { find: 'next/navigation', replacement: path.join(adapters, 'next-navigation.ts') },
        { find: 'next/link', replacement: path.join(adapters, 'next-link.tsx') },
        { find: 'next/dynamic', replacement: path.join(adapters, 'next-dynamic.tsx') },
        { find: 'next/image', replacement: path.join(adapters, 'next-image.tsx') },
        { find: 'next/headers', replacement: path.join(adapters, 'next-headers.ts') },
        { find: 'next/server', replacement: path.join(adapters, 'next-server.ts') },
        { find: 'next/cache', replacement: path.join(adapters, 'next-cache.ts') },
        { find: 'next/script', replacement: path.join(adapters, 'next-script.tsx') },
        { find: 'next/font/google', replacement: emptyModule },
        { find: '@clerk/nextjs/server', replacement: path.join(adapters, 'clerk-server.ts') },
        { find: '@clerk/nextjs', replacement: path.join(adapters, 'clerk.tsx') },
        { find: '@openpanel/nextjs', replacement: path.join(adapters, 'openpanel.ts') },
        { find: '@sentry/nextjs', replacement: path.join(adapters, 'sentry.ts') },
        { find: 'server-only', replacement: emptyModule },
        { find: 'client-only', replacement: emptyModule },
        { find: '@', replacement: dashboard },
      ],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom'],
      exclude: ['next', '@clerk/clerk-react', '@clerk/nextjs'],
    },
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      fs: {
        allow: [path.resolve(root, '../..')],
      },
      proxy: {
        '/api/chat': {
          target: fileEnv.VITE_CHAT_ORIGIN || 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/agent': {
          target: fileEnv.VITE_CHAT_ORIGIN || 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api': {
          target: fileEnv.VITE_PYTHON_API_URL || processEnv.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    publicDir: path.join(dashboard, 'public'),
    build: {
      outDir: 'dist',
      sourcemap: false,
      emptyOutDir: true,
      chunkSizeWarningLimit: 800,
      modulePreload: {
        resolveDependencies(_filename, deps) {
          return deps.filter((dep) => !/(?:^|\/)(?:streamdown|shiki|mermaid|cytoscape|charts|katex)[^/]*$/.test(dep));
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replaceAll('\\', '/');
            if (normalized.includes('/node_modules/streamdown/')) return 'streamdown';
            if (
              normalized.includes('/node_modules/@shikijs/')
              || normalized.includes('/node_modules/shiki/')
            ) {
              return 'shiki';
            }
            if (normalized.includes('/node_modules/mermaid/')) return 'mermaid';
            if (normalized.includes('/node_modules/cytoscape')) return 'cytoscape';
            if (normalized.includes('/node_modules/recharts/')) return 'charts';
            return undefined;
          },
        },
      },
    },
  };
});
