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

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, dashboard, ''),
    ...loadEnv(mode, root, ''),
  };

  const processEnv: Record<string, string> = {
    NODE_ENV: mode === 'production' ? 'production' : 'development',
  };
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key === 'PYTHON_API_URL') {
      processEnv[key] = value;
    }
  }

  return {
    base: './',
    appType: 'spa',
    plugins: [stubUnknownNextImports(), react()],
    envDir: dashboard,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      'process.env': JSON.stringify(processEnv),
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': dashboard,
        'next/navigation': path.join(adapters, 'next-navigation.ts'),
        'next/link': path.join(adapters, 'next-link.tsx'),
        'next/dynamic': path.join(adapters, 'next-dynamic.tsx'),
        'next/image': path.join(adapters, 'next-image.tsx'),
        'next/headers': path.join(adapters, 'next-headers.ts'),
        'next/server': path.join(adapters, 'next-server.ts'),
        'next/cache': path.join(adapters, 'next-cache.ts'),
        'next/script': path.join(adapters, 'next-script.tsx'),
        'next/font/google': emptyModule,
        '@clerk/nextjs': path.join(adapters, 'clerk.tsx'),
        '@clerk/nextjs/server': path.join(adapters, 'clerk-server.ts'),
        '@openpanel/nextjs': path.join(adapters, 'openpanel.ts'),
        '@sentry/nextjs': path.join(adapters, 'sentry.ts'),
        'server-only': emptyModule,
        'client-only': emptyModule,
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom', '@clerk/clerk-react'],
      exclude: ['next'],
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
          target: env.VITE_CHAT_ORIGIN || 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api': {
          target: env.VITE_PYTHON_API_URL || env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    publicDir: path.join(dashboard, 'public'),
    build: {
      outDir: 'dist',
      sourcemap: false,
      emptyOutDir: true,
      chunkSizeWarningLimit: 4000,
    },
  };
});
