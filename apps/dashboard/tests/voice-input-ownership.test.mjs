import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("voice consumers remain thin adapters over the shared lifecycle owner", () => {
  const logger = source(
    "apps/dashboard/components/ai-habit-chat/use-ai-habit-voice.ts",
  );
  const chat = source(
    "apps/dashboard/app/(dashboard)/chat/use-chat-voice-input.ts",
  );

  for (const adapter of [logger, chat]) {
    assert.match(adapter, /useRitualVoiceInput/);
    assert.doesNotMatch(adapter, /MediaRecorder|getUserMedia|AudioContext/);
    assert.match(adapter, /setError:/);
  }
  assert.match(logger, /nativeAutoStopMs:\s*15000/);
  assert.match(logger, /normalizeLoggerVoiceTranscript/);
});

test("shared voice lifecycle owns cleanup and reports terminal errors", () => {
  const shared = source("apps/dashboard/lib/voice/use-ritual-voice-input.ts");

  assert.match(shared, /clearInterval\(nativeVoicePollRef\.current\)/);
  assert.match(shared, /clearTimeout\(nativeVoiceAutoStopRef\.current\)/);
  assert.match(shared, /cancelAnimationFrame\(nativeVoiceSilenceRafRef\.current\)/);
  assert.match(shared, /track\.stop\(\)/);
  assert.match(shared, /formatNativeSpeechError/);
  assert.match(shared, /No speech detected\. Please try again\./);
  assert.match(shared, /Voice error:/);
  assert.match(shared, /microphone-permission-denied/);
});
