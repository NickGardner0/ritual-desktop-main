import {
  useCallback,
  useMemo,
} from 'react';
import {
  useLocation,
  useNavigate,
  useParams as useRouterParams,
} from 'react-router-dom';

export type ReadonlyURLSearchParams = URLSearchParams;

export function usePathname(): string {
  const pathname = useLocation().pathname;
  if (pathname === '/index.html') return '/';
  return pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string | undefined>>() {
  return useRouterParams() as T;
}

export function useRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    prefetch: (_href?: string) => {},
    refresh: () => navigate(location.pathname + location.search, { replace: true }),
  };
}

export function redirect(href: string): never {
  if (typeof window !== 'undefined') {
    window.location.replace(href);
  }
  throw new Error(`redirect:${href}`);
}

export function useSelectedLayoutSegment(): string | null {
  const pathname = usePathname();
  const part = pathname.split('/').filter(Boolean)[0];
  return part || null;
}

export function notFound(): never {
  throw new Error('next/navigation notFound is not available in desktop-ui');
}

export function useSearchParam(name: string): string | null {
  return useSearchParams().get(name);
}

void useCallback;
