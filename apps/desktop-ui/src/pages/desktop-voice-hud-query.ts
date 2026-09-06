export function isDesktopVoiceHudWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('ritual_voice_hud_window') === '1';
}
