/**
 * Voice mode output shaping and reply chip generation.
 *
 * Used by the orchestrator for voice-mode post-processing
 * and generating quick-reply chips for the chat UI.
 */

// ---------------------------------------------------------------------------
// Voice response post-processing
// ---------------------------------------------------------------------------

export function formatVoiceResponse(text: string): string {
  if (!text) return text;

  const MAX_CHARS = 650;
  const MAX_BULLETS = 3;

  let result = text;

  // Remove markdown tables (replace with simple text)
  // Note: Using RegExp constructor to avoid Tailwind extracting the pattern as a class
  result = result.replace(new RegExp('\\|[^\\n]+\\|', 'g'), '');
  result = result.replace(new RegExp('[\\-:]+\\|[\\-:|]+', 'g'), '');

  // Limit bullet lists to MAX_BULLETS items
  const bulletPattern = /^[\s]*[-*•]\s.+$/gm;
  const bullets = result.match(bulletPattern) || [];
  if (bullets.length > MAX_BULLETS) {
    let bulletCount = 0;
    result = result.replace(bulletPattern, (match) => {
      bulletCount++;
      return bulletCount <= MAX_BULLETS ? match : '';
    });
  }

  // Remove excessive newlines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim to max characters (but don't cut mid-sentence if possible)
  if (result.length > MAX_CHARS) {
    const truncated = result.substring(0, MAX_CHARS);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('! ')
    );

    if (lastSentenceEnd > MAX_CHARS * 0.5) {
      result = truncated.substring(0, lastSentenceEnd + 1);
    } else {
      // Check if we're cutting important numeric content
      const hasNumbers = /\d+(\.\d+)?%?/.test(truncated.substring(MAX_CHARS - 100));
      if (hasNumbers) {
        console.warn('⚠️ Voice post-processing: skipping trim to preserve numeric content');
      } else {
        result = truncated + '...';
      }
    }
  }

  // Ensure response ends with a question (add generic one if missing)
  const trimmedResult = result.trim();
  if (!trimmedResult.endsWith('?')) {
    // Check if there's a question somewhere near the end
    const lastQuestionMark = trimmedResult.lastIndexOf('?');
    if (lastQuestionMark > trimmedResult.length - 100) {
      // There's a question near the end, just trim after it
      result = trimmedResult.substring(0, lastQuestionMark + 1);
    } else {
      // Add a generic follow-up question
      result = trimmedResult + '\n\nWant me to break this down further?';
    }
  }

  return result.trim();
}

// ---------------------------------------------------------------------------
// Reply chip generation
// ---------------------------------------------------------------------------

export function generateReplyChips(toolResults: Record<string, unknown>): string[] {
  const chips: string[] = [];

  if (toolResults.screenTimeSpent) {
    chips.push('Show app time table');
    chips.push('Show daily time table');
    chips.push('Last 30 days');
  }

  // Overview recap
  if (toolResults.weeklyOverview || toolResults.dailyOverview || toolResults.monthlyOverview) {
    chips.push('Show app breakdown');
    chips.push('Show daily tables');
    chips.push('Compare periods');
  }

  // Based on trends data
  if (toolResults.trends) {
    const trends = toolResults.trends as { trends?: Array<{ habit_name: string }> };
    if (trends.trends && trends.trends.length > 0) {
      const topHabit = trends.trends[0].habit_name;
      chips.push(`Show anomalies for ${topHabit}`.substring(0, 32));
      chips.push('Last 90 days');
    }
  }

  // Based on anomalies data
  if (toolResults.anomalies) {
    chips.push('Show trends');
    chips.push('Last 7 days');
  }

  // Based on stats/breakdown
  if (toolResults.stats || toolResults.dailyBreakdown) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show anomalies');
  }

  // Fallback generic chips
  if (chips.length === 0) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show insights');
  }

  // Dedupe and limit to 3
  return [...new Set(chips)].slice(0, 3);
}
