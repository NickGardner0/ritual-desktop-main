import { play, type SoundName } from 'cuelume';

const LEGACY_ENABLED_STORAGE_KEY = 'ritual-interaction-sounds';
const PREFERENCES_STORAGE_KEY = 'ritual-interaction-sounds-preferences-v1';
const PREFERENCES_CHANGE_EVENT = 'ritual-interaction-sounds-change';

export type InteractionSoundEvent = 'habitLogCreated' | 'taskCreated' | 'taskCompleted';

export type InteractionSoundCue = {
  enabled: boolean;
  sound: SoundName;
};

export type InteractionSoundPreferences = {
  enabled: boolean;
  volume: number;
  events: Record<InteractionSoundEvent, InteractionSoundCue>;
};

export const INTERACTION_SOUND_EVENT_OPTIONS: ReadonlyArray<{
  id: InteractionSoundEvent;
  label: string;
  description: string;
}> = [
  { id: 'habitLogCreated', label: 'Habit log created', description: 'After a habit entry is saved.' },
  { id: 'taskCreated', label: 'Task created', description: 'After a new task is saved.' },
  { id: 'taskCompleted', label: 'Task completed', description: 'When a task is checked off.' },
];

export const INTERACTION_SOUND_OPTIONS: ReadonlyArray<{ value: SoundName; label: string }> = [
  { value: 'success', label: 'Success' },
  { value: 'ready', label: 'Ready' },
  { value: 'sparkle', label: 'Sparkle' },
  { value: 'bloom', label: 'Bloom' },
  { value: 'chime', label: 'Chime' },
  { value: 'droplet', label: 'Droplet' },
  { value: 'whisper', label: 'Whisper' },
  { value: 'tick', label: 'Tick' },
  { value: 'press', label: 'Press' },
  { value: 'release', label: 'Release' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'error', label: 'Error' },
  { value: 'page', label: 'Page' },
  { value: 'loading', label: 'Loading' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'scan', label: 'Scan' },
  { value: 'arrival', label: 'Arrival' },
];

export const DEFAULT_INTERACTION_SOUND_PREFERENCES: InteractionSoundPreferences = {
  enabled: true,
  volume: 0.28,
  events: {
    habitLogCreated: { enabled: true, sound: 'success' },
    taskCreated: { enabled: true, sound: 'ready' },
    taskCompleted: { enabled: true, sound: 'success' },
  },
};

const allowedSounds = new Set<SoundName>(INTERACTION_SOUND_OPTIONS.map((option) => option.value));
const lastPlayedAt = new Map<InteractionSoundEvent, number>();

function clampVolume(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : DEFAULT_INTERACTION_SOUND_PREFERENCES.volume;
}

function readCue(value: unknown, fallback: InteractionSoundCue): InteractionSoundCue {
  if (!value || typeof value !== 'object') return { ...fallback };
  const candidate = value as Partial<InteractionSoundCue>;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    sound: allowedSounds.has(candidate.sound as SoundName) ? candidate.sound as SoundName : fallback.sound,
  };
}

export function readInteractionSoundPreferences(): InteractionSoundPreferences {
  if (typeof window === 'undefined') return DEFAULT_INTERACTION_SOUND_PREFERENCES;

  const legacyEnabled = window.localStorage.getItem(LEGACY_ENABLED_STORAGE_KEY) !== 'off';
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_INTERACTION_SOUND_PREFERENCES, enabled: legacyEnabled };
    const parsed = JSON.parse(raw) as Partial<InteractionSoundPreferences>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : legacyEnabled,
      volume: clampVolume(parsed.volume),
      events: {
        habitLogCreated: readCue(parsed.events?.habitLogCreated, DEFAULT_INTERACTION_SOUND_PREFERENCES.events.habitLogCreated),
        taskCreated: readCue(parsed.events?.taskCreated, DEFAULT_INTERACTION_SOUND_PREFERENCES.events.taskCreated),
        taskCompleted: readCue(parsed.events?.taskCompleted, DEFAULT_INTERACTION_SOUND_PREFERENCES.events.taskCompleted),
      },
    };
  } catch {
    return { ...DEFAULT_INTERACTION_SOUND_PREFERENCES, enabled: legacyEnabled };
  }
}

export function writeInteractionSoundPreferences(preferences: InteractionSoundPreferences): void {
  if (typeof window === 'undefined') return;
  const next: InteractionSoundPreferences = {
    ...preferences,
    volume: clampVolume(preferences.volume),
    events: {
      habitLogCreated: readCue(preferences.events.habitLogCreated, DEFAULT_INTERACTION_SOUND_PREFERENCES.events.habitLogCreated),
      taskCreated: readCue(preferences.events.taskCreated, DEFAULT_INTERACTION_SOUND_PREFERENCES.events.taskCreated),
      taskCompleted: readCue(preferences.events.taskCompleted, DEFAULT_INTERACTION_SOUND_PREFERENCES.events.taskCompleted),
    },
  };
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  window.localStorage.setItem(LEGACY_ENABLED_STORAGE_KEY, next.enabled ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent(PREFERENCES_CHANGE_EVENT, { detail: next }));
}

export function updateInteractionSoundPreferences(
  update: (current: InteractionSoundPreferences) => InteractionSoundPreferences,
): InteractionSoundPreferences {
  const next = update(readInteractionSoundPreferences());
  writeInteractionSoundPreferences(next);
  return next;
}

export function subscribeToInteractionSoundPreferences(
  listener: (preferences: InteractionSoundPreferences) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const notify = () => listener(readInteractionSoundPreferences());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PREFERENCES_STORAGE_KEY || event.key === LEGACY_ENABLED_STORAGE_KEY) notify();
  };

  window.addEventListener(PREFERENCES_CHANGE_EVENT, notify);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(PREFERENCES_CHANGE_EVENT, notify);
    window.removeEventListener('storage', handleStorage);
  };
}

export function playInteractionSound(event: InteractionSoundEvent): void {
  const preferences = readInteractionSoundPreferences();
  const cue = preferences.events[event];
  if (!preferences.enabled || !cue.enabled || preferences.volume <= 0) return;

  const now = Date.now();
  if (now - (lastPlayedAt.get(event) || 0) < 250) return;
  lastPlayedAt.set(event, now);
  play(cue.sound);
}

export function readInteractionSoundsEnabled(): boolean {
  return readInteractionSoundPreferences().enabled;
}

export function writeInteractionSoundsEnabled(enabled: boolean): void {
  updateInteractionSoundPreferences((current) => ({ ...current, enabled }));
}

export function subscribeToInteractionSounds(listener: (enabled: boolean) => void): () => void {
  return subscribeToInteractionSoundPreferences((preferences) => listener(preferences.enabled));
}
