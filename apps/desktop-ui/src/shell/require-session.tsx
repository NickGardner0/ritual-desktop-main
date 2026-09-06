import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useUser } from '../adapters/clerk';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { readDesktopSettingsWindowView } from '../pages/desktop-settings-query';

export function StartingRitual() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fefefe]">
      <BrailleSpinner className="text-2xl text-gray-900" />
    </main>
  );
}

export function RequireDesktopSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const settingsView = readDesktopSettingsWindowView();

  if (!isLoaded) {
    return <StartingRitual />;
  }

  if (!isSignedIn) {
    if (settingsView) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#fefefe] px-6 text-center text-sm text-[#666666]">
          Sign in from the main window to open Settings.
        </main>
      );
    }
    return <Navigate to="/sign-in" replace />;
  }

  return children;
}
