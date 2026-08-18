export type ChatStreamPhase = "context" | "searching" | "tool" | "answering";

export const PHASE_LABELS: Record<ChatStreamPhase, string>;

export function parsePhaseLine(line: string): { phase: ChatStreamPhase; label: string | null } | null;

export function labelForChatPhase(phase: ChatStreamPhase, label?: string | null): string;
