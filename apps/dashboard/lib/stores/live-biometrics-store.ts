import { useSyncExternalStore } from "react";
import type { LiveBiometrics } from "@/lib/types/biometrics";

const EMPTY_LIVE_BIOMETRICS: LiveBiometrics = {
  current_bpm: null,
  current_source_type: null,
  latest_sample_at: null,
  connection_state: "disconnected",
  is_stale: true,
};

let snapshot: LiveBiometrics = EMPTY_LIVE_BIOMETRICS;
const listeners = new Set<() => void>();

export const liveBiometricsStore = {
  getSnapshot(): LiveBiometrics {
    return snapshot;
  },
  setSnapshot(next: LiveBiometrics) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  },
  reset() {
    snapshot = EMPTY_LIVE_BIOMETRICS;
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useLiveBiometricsStore(): LiveBiometrics {
  return useSyncExternalStore(
    liveBiometricsStore.subscribe,
    liveBiometricsStore.getSnapshot,
    liveBiometricsStore.getSnapshot,
  );
}

