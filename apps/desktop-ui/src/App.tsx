// @ts-nocheck
import './dashboard-css';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useUser } from '@clerk/nextjs';
import { RootProviders } from '@/components/root-providers';
import { DashboardLayoutClient } from '@/app/(dashboard)/dashboard-layout-client';
import { LogsClient } from '@/app/(dashboard)/activity/logs-client';
import { ChatClient } from '@/app/(dashboard)/chat/chat-client';
import { CalendarClient } from '@/app/(dashboard)/calendar/calendar-client';
import { IntegrationsClient } from '@/app/(dashboard)/integrations/integrations-client';
import { ReportsClient } from '@/app/(dashboard)/reports/reports-client';
import { TasksClient } from '@/app/(dashboard)/tasks/tasks-client';
import { RoutinesClient } from '@/app/(dashboard)/routines/routines-client';
import { ExperimentsClient } from '@/app/(dashboard)/experiments/experiments-client';
import { ClientDashboard } from '@/app/(dashboard)/dashboard/client-dashboard';
import AuthCallbackPage from '@/app/auth/callback/page';
import SsoCallbackPage from '@/app/auth/sso-callback/page';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { DesktopAuthPage } from './pages/desktop-auth-page';

const CLERK_LOAD_GRACE_MS = 1_500;

function Shell({ children }: { children: ReactNode }) {
  return (
    <DashboardLayoutClient>
      {children}
    </DashboardLayoutClient>
  );
}

function StartingRitual() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fcfcfa]">
      <BrailleSpinner className="text-2xl text-gray-900" />
    </main>
  );
}

function RequireDesktopSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const [giveUpWaiting, setGiveUpWaiting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setGiveUpWaiting(true), CLERK_LOAD_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (isSignedIn) {
    return children;
  }

  if (!isLoaded && !giveUpWaiting) {
    return <StartingRitual />;
  }

  return <Navigate to="/sign-in" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <RootProviders>
        <Routes>
          <Route path="/sign-in/*" element={<DesktopAuthPage mode="sign_in" />} />
          <Route path="/sign-up/*" element={<DesktopAuthPage mode="sign_up" />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/sso-callback" element={<SsoCallbackPage />} />
          <Route
            path="/*"
            element={(
              <RequireDesktopSession>
                <Shell>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/index.html" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<ClientDashboard initialViewMode="overview" />} />
                    <Route path="/activity" element={<LogsClient />} />
                    <Route path="/chat" element={<ChatClient />} />
                    <Route path="/calendar" element={<CalendarClient />} />
                    <Route path="/integrations" element={<IntegrationsClient />} />
                    <Route path="/reports" element={<ReportsClient />} />
                    <Route path="/tasks" element={<TasksClient />} />
                    <Route path="/routines" element={<RoutinesClient />} />
                    <Route path="/experiments" element={<ExperimentsClient />} />
                    <Route path="/analytics" element={<Navigate to="/dashboard?view=metrics" replace />} />
                    <Route path="/approvals" element={<Navigate to="/reports" replace />} />
                    <Route path="/workflows" element={<Navigate to="/reports" replace />} />
                  </Routes>
                </Shell>
              </RequireDesktopSession>
            )}
          />
        </Routes>
      </RootProviders>
    </BrowserRouter>
  );
}
