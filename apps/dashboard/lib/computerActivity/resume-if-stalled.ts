import {
  desktopHasCapability,
  desktopSetComputerTracking,
  getDesktopResidentRuntimeState,
} from '@/lib/native-gateway';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';

export async function resumeComputerTrackingIfStalled(): Promise<boolean> {
  if (!isDesktopTauriRuntime()) {
    return false;
  }
  if (!(await desktopHasCapability('desktop-resident-runtime-v1'))) {
    return false;
  }

  const resident = await getDesktopResidentRuntimeState();
  if (!resident?.trackingEnabled || resident.watcherRunning) {
    return false;
  }

  const recovered = await desktopSetComputerTracking({ enabled: true });
  return Boolean(recovered?.watcherRunning || recovered?.trackingEnabled);
}
