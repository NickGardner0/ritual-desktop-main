import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Launching Ritual',
  description: 'Preparing the Ritual desktop app.',
};

function readSingleParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default async function DesktopBootstrapPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const targetParams = new URLSearchParams();
  const ritualEnv = readSingleParam(resolvedSearchParams, 'ritual_desktop_env');
  const detachedSidebar = readSingleParam(resolvedSearchParams, 'ritual_detached_sidebar');
  const transparencyProbe = readSingleParam(resolvedSearchParams, 'ritual_transparency_probe');

  if (ritualEnv) {
    targetParams.set('ritual_desktop_env', ritualEnv);
  }
  if (detachedSidebar === '1') {
    targetParams.set('ritual_detached_sidebar', '1');
  }
  if (transparencyProbe === '1') {
    targetParams.set('ritual_transparency_probe', '1');
  }

  const redirectTarget = targetParams.toString() ? `/?${targetParams.toString()}` : '/';
  redirect(`/sign-in?redirect_url=${encodeURIComponent(redirectTarget)}`);
}
