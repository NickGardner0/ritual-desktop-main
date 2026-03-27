"use client";

import { isTauri } from "@/lib/tauri-utils";

export type NativeSpeechState = {
  event: string;
  transcript: string;
  timestamp: number;
};

export async function startNativeDesktopSpeechRecognition(): Promise<void> {
  if (!isTauri()) {
    throw new Error("Native speech recognition is only available in Ritual Desktop.");
  }

  const { invoke } = await import("@tauri-apps/api/tauri");
  await invoke("start_native_speech_recognition");
}

export async function stopNativeDesktopSpeechRecognition(): Promise<void> {
  if (!isTauri()) return;

  const { invoke } = await import("@tauri-apps/api/tauri");
  await invoke("stop_native_speech_recognition");
}

export async function getNativeDesktopSpeechState(): Promise<NativeSpeechState> {
  if (!isTauri()) {
    return { event: "", transcript: "", timestamp: 0 };
  }

  const { invoke } = await import("@tauri-apps/api/tauri");
  return invoke<NativeSpeechState>("get_native_speech_state");
}

export async function clearNativeDesktopSpeechState(): Promise<void> {
  if (!isTauri()) return;

  const { invoke } = await import("@tauri-apps/api/tauri");
  await invoke("clear_native_speech_state");
}

export function getNativeSpeechErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const maybeError = error as {
      message?: string;
      error?: string;
      reason?: string;
    };

    if (typeof maybeError.message === "string" && maybeError.message) {
      return maybeError.message;
    }

    if (typeof maybeError.error === "string" && maybeError.error) {
      return maybeError.error;
    }

    if (typeof maybeError.reason === "string" && maybeError.reason) {
      return maybeError.reason;
    }
  }

  return "";
}

export function formatNativeSpeechError(message: string): string {
  switch (message) {
    case "microphone-permission-denied":
      return "Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.";
    case "speech-permission-denied":
      return "Speech recognition access denied. Enable it in System Settings > Privacy & Security > Speech Recognition.";
    case "recognizer-unavailable":
      return "Speech recognition is unavailable right now. Try again in a moment.";
    case "audio-engine-failed":
      return "The microphone could not be started. Try closing other apps using the microphone.";
    case "request-failed":
      return "Speech recognition could not be initialized. Please try again.";
    default:
      return message ? `Voice error: ${message}` : "Voice logging failed. Please try again.";
  }
}
