import type { ReactNode } from 'react';

export default function Script({ children }: { children?: ReactNode }) {
  return children ?? null;
}
