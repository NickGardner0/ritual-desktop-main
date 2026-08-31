// @ts-nocheck
import './dashboard-css';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useUser } from '@clerk/nextjs';
import { RootProviders } from '@/components/root-providers';
import { DashboardLayoutClient } from '@/app/(dashboard)/dashboard-layout-client';
import { ClientDashboard } from '@/app/(dashboard)/dashboard/client-dashboard';
import AuthCallbackPage from '@/app/auth/callback/page';
import SsoCallbackPage from '@/app/auth/sso-callback/page';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { DesktopAuthPage } from './pages/desktop-auth-page';

const LogsClient = lazy(() =>
  import('@/app/(dashboard)/activity/logs-client').then((module) => ({ default: module.LogsClient })),
);
const ChatClient = lazy(() =>
  import('@/app/(dashboard)/chat/chat-client').then((module) => ({ default: module.ChatClient })),
);
const CalendarClient = lazy(() =>
  import('@/app/(dashboard)/calendar/calendar-client').then((module) => ({ default: module.CalendarClient })),
);
const IntegrationsClient = lazy(() =>
  import('@/app/(dashboard)/integrations/integrations-client').then((module) => ({ default: module.IntegrationsClient })),
);
const ReportsClient = lazy(() =>
  import('@/app/(dashboard)/reports/reports-client').then((module) => ({ default: module.ReportsClient })),
);
const TasksClient = lazy(() =>
  import('@/app/(dashboard)/tasks/tasks-client').then((module) => ({ default: module.TasksClient })),
);
const RoutinesClient = lazy(() =>
  import('@/app/(dashboard)/routines/routines-client').then((module) => ({ default: module.RoutinesClient })),
);
const ExperimentsClient = lazy(() =>
  import('@/app/(dashboard)/experiments/experiments-client').then((module) => ({ default: module.ExperimentsClient })),
);

function Shell({ children }: { children: ReactNode }) {
  return (
    <DashboardLayoutClient>
      {children}
    </DashboardLayoutClient>
  );
}

function StartingRitual() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fefefe]">
      <BrailleSpinner className="text-2xl text-gray-900" />
    </main>
  );
}

function RequireDesktopSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return <StartingRitual />;
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  return children;
}

function DesktopAppRoutes() {
  return (
    <Suspense fallback={<StartingRitual />}>
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
    </Suspense>
  );
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
              <Shell>
                <RequireDesktopSession>
                  <DesktopAppRoutes />
                </RequireDesktopSession>
              </Shell>
            )}
          />
        </Routes>
      </RootProviders>
    </BrowserRouter>
  );
}
