import { invoke } from '@tauri-apps/api/tauri'

export class NativeTimer {
  private static instance: NativeTimer | null = null

  static getInstance(): NativeTimer {
    if (!NativeTimer.instance) {
      NativeTimer.instance = new NativeTimer()
    }
    return NativeTimer.instance
  }

  async createWidget(): Promise<void> {
    try {
      const result = await invoke('create_native_timer_widget')
      console.log('Native timer widget created:', result)
    } catch (error) {
      console.error('Failed to create native timer widget:', error)
      throw error
    }
  }

  async closeWidget(): Promise<void> {
    try {
      const result = await invoke('close_native_timer_widget')
      console.log('Native timer widget closed:', result)
    } catch (error) {
      console.error('Failed to close native timer widget:', error)
      throw error
    }
  }
}