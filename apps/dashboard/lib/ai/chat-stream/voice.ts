// Voice mode output shaping.

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
      const hasNumbers = /\d+(\.\d+)?%?/.test(truncated.substring(MAX_CHARS - 100));
      if (hasNumbers) {
        console.warn('⚠️ Voice post-processing: skipping trim to preserve numeric content');
      } else {
        result = truncated + '...';
      }
    }
  }

  // Ensure response ends with a question
  const trimmedResult = result.trim();
  if (!trimmedResult.endsWith('?')) {
    const lastQuestionMark = trimmedResult.lastIndexOf('?');
    if (lastQuestionMark > trimmedResult.length - 100) {
      result = trimmedResult.substring(0, lastQuestionMark + 1);
    } else {
      result = trimmedResult + '\n\nWant me to break this down further?';
    }
  }

  return result.trim();
}

export function generateReplyChips(toolResults: Record<string, unknown>): string[] {
  const chips: string[] = [];

  if (toolResults.trends) {
    const trends = toolResults.trends as { trends?: Array<{ habit_name: string }> };
    if (trends.trends && trends.trends.length > 0) {
      const topHabit = trends.trends[0].habit_name;
      chips.push(`Show anomalies for ${topHabit}`.substring(0, 32));
      chips.push('Last 90 days');
    }
  }

  if (toolResults.anomalies) {
    chips.push('Show trends');
    chips.push('Last 7 days');
  }

  if (toolResults.stats || toolResults.dailyBreakdown) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show anomalies');
  }

  if (chips.length === 0) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show insights');
  }

  return [...new Set(chips)].slice(0, 3);
}
