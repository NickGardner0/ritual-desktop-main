/**
 * OpenCode-style drain helpers: doom-loop detection and fork compaction.
 * Ritual keeps its existing 19 tools and observe|draft|organize|act profiles.
 */

const DOOM_LOOP_REPEAT = 3;
const TOOL_RESULT_CHAR_BUDGET = 8_000;
const COMPACT_AFTER_MESSAGES = 18;

export function toolBatchSignature(
  calls: Array<{ name: string; arguments?: string }>,
): string {
  return calls
    .map((call) => `${call.name}:${(call.arguments || '').trim()}`)
    .sort()
    .join('|');
}

export function isDoomLoop(
  history: string[],
  nextSignature: string,
  repeat = DOOM_LOOP_REPEAT,
): boolean {
  if (!nextSignature) return false;
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index] !== nextSignature) break;
    streak += 1;
    if (streak >= repeat - 1) return true;
  }
  return false;
}

export function pruneBulkyToolResult(content: string, budget = TOOL_RESULT_CHAR_BUDGET): string {
  if (content.length <= budget) return content;
  return `${content.slice(0, budget)}\n…[truncated bulky tool result]`;
}

export function compactApiMessages<T extends { role: string; content?: unknown }>(
  messages: T[],
  options?: { protectSystem?: boolean },
): T[] {
  if (messages.length <= COMPACT_AFTER_MESSAGES) {
    return messages.map((message) => {
      if (message.role !== 'tool' || typeof message.content !== 'string') return message;
      return { ...message, content: pruneBulkyToolResult(message.content) };
    });
  }

  const protectSystem = options?.protectSystem !== false;
  const head: T[] = [];
  const tailStart = Math.max(0, messages.length - 10);

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (protectSystem && message.role === 'system' && index < 3) {
      head.push(message);
      continue;
    }
    if (index >= tailStart) continue;
    if (message.role === 'tool' && typeof message.content === 'string') {
      head.push({ ...message, content: pruneBulkyToolResult(message.content, 1_200) });
      continue;
    }
    if (message.role === 'assistant' || message.role === 'user') {
      head.push(message);
    }
  }

  const tail = messages.slice(tailStart).map((message) => {
    if (message.role !== 'tool' || typeof message.content !== 'string') return message;
    return { ...message, content: pruneBulkyToolResult(message.content) };
  });

  return [...head, ...tail];
}
