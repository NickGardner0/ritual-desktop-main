const INTERACTION_SOUNDS_STORAGE_KEY = 'ritual-interaction-sounds';
const INTERACTION_SOUNDS_CHANGE_EVENT = 'ritual-interaction-sounds-change';

export function readInteractionSoundsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(INTERACTION_SOUNDS_STORAGE_KEY) !== 'off';
}

export function writeInteractionSoundsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INTERACTION_SOUNDS_STORAGE_KEY, enabled ? 'on' : 'off');
  window.dispatchEvent(new Event(INTERACTION_SOUNDS_CHANGE_EVENT));
}

export function subscribeToInteractionSounds(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const notify = () => listener(readInteractionSoundsEnabled());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === INTERACTION_SOUNDS_STORAGE_KEY) notify();
  };

  window.addEventListener(INTERACTION_SOUNDS_CHANGE_EVENT, notify);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(INTERACTION_SOUNDS_CHANGE_EVENT, notify);
    window.removeEventListener('storage', handleStorage);
  };
}
