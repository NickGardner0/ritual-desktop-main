// @ts-nocheck
import './dashboard-css';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ClientDashboard } from '@/app/(dashboard)/dashboard/client-dashboard';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { DesktopAuthPage } from './pages/desktop-auth-page';
import { readDesktopSettingsWindowView } from './pages/desktop-settings-query';
import { isDesktopVoiceHudWindow } from './pages/desktop-voice-hud-query';
import { DesktopShellLayout, RequireDesktopSession, RootProviders, StartingRitual } from './shell';

const AuthCallbackPage = lazy(() => import('@/app/auth/callback/page'));
const SsoCallbackPage = lazy(() => import('@/app/auth/sso-callback/page'));
const LogsClient = lazy(() =>
  import('@/app/(dashboard)/activity/logs-client').then((module) => ({ default: module.LogsClient })),
);
const ChatClient = lazy(() =>
  import('@/app/(dashboard)/chat/chat-client').then((module) => ({ default: module.ChatClient })),
);
const AgentChat = lazy(() =>
  import('@/app/(dashboard)/agent/agent-chat').then((module) => ({ default: module.AgentChat })),
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
const DesktopSettingsWindow = lazy(() =>
  import('./pages/desktop-settings-window').then((module) => ({ default: module.DesktopSettingsWindow })),
);
const VoiceHudPage = lazy(() => import('@/app/voice-hud/page'));

function Shell({ children }: { children: ReactNode }) {
  return (
    <DesktopShellLayout>
      {children}
    </DesktopShellLayout>
  );
}

function RouteFallback() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center" aria-hidden>
      <BrailleSpinner className="text-lg text-gray-400" />
    </div>
  );
}

function DesktopAppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/index.html" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<ClientDashboard initialViewMode="overview" />} />
        <Route path="/activity" element={<LogsClient />} />
        <Route path="/chat" element={<ChatClient />} />
        <Route path="/agent" element={<AgentChat />} />
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
  if (isDesktopVoiceHudWindow()) {
    return (
      <BrowserRouter>
        <RootProviders>
          <Suspense fallback={null}>
            <VoiceHudPage />
          </Suspense>
        </RootProviders>
      </BrowserRouter>
    );
  }

  const settingsView = readDesktopSettingsWindowView();
  if (settingsView) {
    return (
      <BrowserRouter>
        <RootProviders>
          <RequireDesktopSession>
            <Suspense fallback={<StartingRitual />}>
              <DesktopSettingsWindow initialView={settingsView} />
            </Suspense>
          </RequireDesktopSession>
        </RootProviders>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <RootProviders>
        <Routes>
        <Route path="/sign-in/*" element={<DesktopAuthPage mode="sign_in" />} />
          <Route path="/sign-up/*" element={<DesktopAuthPage mode="sign_up" />} />
          <Route
            path="/auth/callback"
            element={(
              <Suspense fallback={<StartingRitual />}>
                <AuthCallbackPage />
              </Suspense>
            )}
          />
          <Route
            path="/auth/sso-callback"
            element={(
              <Suspense fallback={<StartingRitual />}>
                <SsoCallbackPage />
              </Suspense>
            )}
          />
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
