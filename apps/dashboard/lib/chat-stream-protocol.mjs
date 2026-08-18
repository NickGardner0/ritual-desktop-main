export const PHASE_LABELS = {
  context: "Preparing context...",
  searching: "Thinking...",
  tool: "Fetching data...",
  answering: "Writing...",
};

export function parsePhaseLine(line) {
  const match = line.match(/__PHASE__(.+?)__END_PHASE__/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (
      parsed?.phase === "context"
      || parsed?.phase === "searching"
      || parsed?.phase === "tool"
      || parsed?.phase === "answering"
    ) {
      return {
        phase: parsed.phase,
        label: typeof parsed.label === "string" && parsed.label.trim() ? parsed.label : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function labelForChatPhase(phase, label) {
  if (label && String(label).trim()) return label;
  return PHASE_LABELS[phase];
}
