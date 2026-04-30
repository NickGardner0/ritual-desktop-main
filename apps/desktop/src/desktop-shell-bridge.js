import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

export async function invokeDesktopShellCommand(command, args) {
  return invoke(command, args);
}

export async function openDesktopShellExternalUrl(url) {
  return open(url);
}

export async function recordDesktopShellEvent(name, level = 'info', data = null) {
  try {
    await invoke('desktop_record_shell_event', {
      name,
      level,
      data,
    });
  } catch (error) {
    console.warn('Desktop shell event logging failed:', error);
  }
}
