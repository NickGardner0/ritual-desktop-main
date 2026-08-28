/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PYTHON_API_URL?: string;
  readonly VITE_CHAT_ORIGIN?: string;
  readonly VITE_HOSTED_ORIGIN?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  readonly NEXT_PUBLIC_PYTHON_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css';
