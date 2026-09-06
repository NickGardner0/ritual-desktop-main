import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { DesktopRuntimeBridge } from '@/components/desktop-runtime-bridge';
import { AIProvider } from '@/contexts/AIContext';
import { FontProvider } from '@/contexts/FontContext';
import { SidebarModeProvider } from '@/contexts/SidebarModeContext';
import { runWhenIdle } from '@/lib/run-when-idle';

const RoutineSchedulerRuntime = lazy(() => import('@/lib/routines/routine-scheduler-runtime'));

function RoutineSchedulerBridge() {
  const [ready, setReady] = useState(false);

  useEffect(() => runWhenIdle(() => setReady(true)), []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <RoutineSchedulerRuntime />
    </Suspense>
  );
}

export function DesktopShellLayout({ children }: { children: ReactNode }) {
  return (
    <FontProvider>
      <SidebarModeProvider>
        <AIProvider>
          <DesktopRuntimeBridge />
          <RoutineSchedulerBridge />
          <DashboardLayout>
            {children}
          </DashboardLayout>
        </AIProvider>
      </SidebarModeProvider>
    </FontProvider>
  );
}
