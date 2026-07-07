'use client';

/** Best-effort system notification; quietly no-ops when unsupported or denied. */
export function sendRoutineNotification(title: string, body: string): void {
  try {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') new Notification(title, { body });
      });
    }
  } catch {
    // The in-app toast already covers this case.
  }
}
