'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { play, type SoundName } from 'cuelume';
import { Play, Volume2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  INTERACTION_SOUND_EVENT_OPTIONS,
  INTERACTION_SOUND_OPTIONS,
  readInteractionSoundPreferences,
  subscribeToInteractionSoundPreferences,
  writeInteractionSoundPreferences,
  type InteractionSoundEvent,
  type InteractionSoundPreferences,
} from '@/lib/interaction-sounds';
import {
  SettingsGroup,
  SettingsRow,
} from '@/components/ui/ritual-system';

export function InteractionSoundSettings() {
  const [preferences, setPreferences] = useState<InteractionSoundPreferences>(readInteractionSoundPreferences);

  useEffect(() => subscribeToInteractionSoundPreferences(setPreferences), []);

  const commit = (next: InteractionSoundPreferences) => {
    setPreferences(next);
    writeInteractionSoundPreferences(next);
  };

  const updateEvent = (
    id: InteractionSoundEvent,
    update: Partial<InteractionSoundPreferences['events'][InteractionSoundEvent]>,
  ) => {
    commit({
      ...preferences,
      events: {
        ...preferences.events,
        [id]: { ...preferences.events[id], ...update },
      },
    });
  };

  const preview = (sound: SoundName) => {
    if (!preferences.enabled || preferences.volume <= 0) return;
    play(sound);
  };

  return (
    <div className="space-y-[18px]">
      <SettingsSection title="Playback">
        <SettingsRow>
          <SettingLabel
            icon={<Volume2 className="h-[15px] w-[15px]" strokeWidth={1.9} />}
            title="Interaction sounds"
            description="Play quiet feedback after actions you complete."
          />
          <SoundToggle
            checked={preferences.enabled}
            label="Interaction sounds"
            onChange={(enabled) => commit({ ...preferences, enabled })}
          />
        </SettingsRow>

        <SettingsRow>
          <SettingLabel
            title="Volume"
            description="Sets the loudness for every Ritual interaction cue."
          />
          <div className="flex min-w-[220px] items-center justify-end gap-2.5">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(preferences.volume * 100)}
              onChange={(event) => commit({ ...preferences, volume: Number(event.target.value) / 100 })}
              className="h-1.5 w-[120px] cursor-pointer accent-black"
              aria-label="Interaction sound volume"
            />
            <span className="w-9 text-right text-[12px] tabular-nums text-[var(--text-secondary)]">
              {Math.round(preferences.volume * 100)}%
            </span>
            <button
              type="button"
              onClick={() => preview('success')}
              disabled={!preferences.enabled || preferences.volume <= 0}
              className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--row-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-3 w-3" fill="currentColor" />
              Preview
            </button>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Action cues">
        {INTERACTION_SOUND_EVENT_OPTIONS.map((event) => {
          const cue = preferences.events[event.id];
          return (
            <SettingsRow key={event.id}>
              <SettingLabel title={event.label} description={event.description} />
              <div className="flex items-center gap-2">
                <select
                  value={cue.sound}
                  onChange={(changeEvent) => {
                    const sound = changeEvent.target.value as SoundName;
                    updateEvent(event.id, { sound });
                    window.requestAnimationFrame(() => preview(sound));
                  }}
                  disabled={!preferences.enabled || !cue.enabled}
                  className="h-7 min-w-[112px] rounded-[7px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-[12px] font-medium text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] disabled:opacity-45"
                  aria-label={`${event.label} sound`}
                >
                  {INTERACTION_SOUND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => preview(cue.sound)}
                  disabled={!preferences.enabled || !cue.enabled}
                  className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--icon-muted)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={`Preview ${event.label} sound`}
                >
                  <Play className="h-3.5 w-3.5" fill="currentColor" />
                </button>
                <SoundToggle
                  checked={cue.enabled}
                  disabled={!preferences.enabled}
                  label={event.label}
                  onChange={(enabled) => updateEvent(event.id, { enabled })}
                />
              </div>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <p className="px-1 text-[11px] leading-[16px] text-[var(--text-muted)]">
        Sounds are synthesized locally by Cuelume. No audio recordings or sound files are sent over the network.
      </p>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-[8px] text-[13px] font-semibold leading-tight text-[var(--text-primary)]">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  );
}

function SettingLabel({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {icon ? (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[var(--icon-muted)]">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-[16px] text-[var(--text-primary)]">{title}</p>
        <p className="mt-[2px] max-w-[340px] text-[12px] leading-[15px] text-[var(--text-muted)]">{description}</p>
      </div>
    </div>
  );
}

function SoundToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'bg-black' : 'bg-[var(--surface-control)]',
      )}
    >
      <span
        className={cn(
          'inline-block h-[17px] w-[17px] rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[19px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
