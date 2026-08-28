// @ts-nocheck
import './dashboard-css';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SignIn, SignUp } from '@clerk/clerk-react';
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

function Shell({ children }: { children: ReactNode }) {
  return (
    <DashboardLayoutClient>
      {children}
    </DashboardLayoutClient>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <RootProviders>
        <Routes>
          <Route path="/sign-in/*" element={<div className="flex min-h-screen items-center justify-center"><SignIn routing="path" path="/sign-in" /></div>} />
          <Route path="/sign-up/*" element={<div className="flex min-h-screen items-center justify-center"><SignUp routing="path" path="/sign-up" /></div>} />
          <Route
            path="/*"
            element={(
              <Shell>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/index.html" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<ClientDashboard initialViewMode="overview" initialUserId={null} />} />
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
            )}
          />
        </Routes>
      </RootProviders>
    </BrowserRouter>
  );
}
