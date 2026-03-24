import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BACKEND_URL =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

interface HabitMetric {
  name: string;
  value: string;
}

function formatMs(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    const token = await getToken();
    const { date, habitMetrics, timezone } = (await req.json()) as {
      date: string;
      habitMetrics?: HabitMetric[];
      timezone?: string;
    };

    if (!date) {
      return new Response('Missing date', { status: 400 });
    }

    const headers = buildBackendAuthHeaders({ userId, token });

    // Date formatting
    const [year, month, day] = date.split('-').map(Number);
    const localDate = new Date(year, month - 1, day, 12, 0, 0);
    const dayOfWeek = localDate.toLocaleDateString('en-US', { weekday: 'long' });

    const metricsText =
      habitMetrics && habitMetrics.length > 0
        ? habitMetrics.map((m) => `${m.name}: ${m.value}`).join('\n')
        : 'No habit data logged.';

    // Fetch screen evidence + top apps/domains in parallel (fast, <5s)
    const params = new URLSearchParams({
      start_date: date,
      end_date: date,
      limit: '8',
    });

    const [screenEvidence, appsData, domainsData, gitData] = await Promise.all([
      fetch(
        `${BACKEND_URL}/api/watcher/screen-evidence?date=${date}&limit=80`,
        { headers, signal: AbortSignal.timeout(8000) }
      )
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`${BACKEND_URL}/api/watcher/stats/top-apps?${params}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      })
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`${BACKEND_URL}/api/watcher/stats/top-domains?${params}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      })
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      // Git commit history for the day — shows what was actually accomplished in code
      fetch(
        `${BACKEND_URL}/api/watcher/git-commits?date=${date}`,
        { headers, signal: AbortSignal.timeout(5000) }
      )
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]);

    // Build context
    const contextParts: string[] = [];

    if (screenEvidence?.success) {
      const titles = screenEvidence.window_titles || [];
      if (titles.length > 0) {
        const lines = titles.map(
          (t: any) =>
            `${t.app_name}${t.window_title ? ' — ' + t.window_title : ''} (${t.frequency} captures)`
        );
        contextParts.push('Screen activity (window titles, sorted by time spent):\n' + lines.join('\n'));
      }
      const snippets = screenEvidence.ocr_snippets || [];
      if (snippets.length > 0) {
        // Include richer OCR content with timestamps — lets the LLM understand WHAT was being done and WHEN
        const snippetLines = snippets.map((s: any) => {
          let timeStr = '';
          if (s.time) {
            const d = new Date(typeof s.time === 'number' && s.time > 1e12 ? s.time : s.time * 1000);
            if (!isNaN(d.getTime())) {
              timeStr = d.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                ...(timezone ? { timeZone: timezone } : {}),
              });
            }
          }
          const docPath = s.document_path ? ` (${s.document_path})` : '';
          const semanticLine = s.semantic_summary ? `\nSemantic: ${s.semantic_summary}` : '';
          const header = timeStr
            ? `[${timeStr}] ${s.app_name} — ${s.window_title}${docPath}`
            : `${s.app_name} — ${s.window_title}${docPath}`;
          return `${header}${semanticLine}\n${s.snippet}`;
        });
        contextParts.push('Screen content samples (OCR text with timestamps, in chronological order):\n\n' + snippetLines.join('\n\n'));
      }
    }

    if (appsData) {
      const apps = appsData?.apps || appsData?.data || [];
      if (Array.isArray(apps) && apps.length > 0) {
        const appLines = apps.slice(0, 8).map((a: any) => {
          const name = a.app_name || a.name || 'Unknown';
          const ms = a.total_active_ms || a.active_ms || a.total_ms || 0;
          return ms > 0 ? `${name}: ${formatMs(ms)}` : name;
        }).filter(Boolean);
        if (appLines.length) contextParts.push('Top apps by active time:\n' + appLines.join('\n'));
      }
    }

    if (domainsData) {
      const domains = domainsData?.domains || domainsData?.data || [];
      if (Array.isArray(domains) && domains.length > 0) {
        const domainLines = domains.slice(0, 6).map((d: any) => {
          const name = d.domain || d.name || 'Unknown';
          const ms = d.total_active_ms || d.active_ms || d.total_ms || 0;
          return ms > 0 ? `${name}: ${formatMs(ms)}` : name;
        }).filter(Boolean);
        if (domainLines.length) contextParts.push('Top websites:\n' + domainLines.join('\n'));
      }
    }

    // Git commits — concrete evidence of what was accomplished in code
    if (gitData?.success && Array.isArray(gitData.commits) && gitData.commits.length > 0) {
      const commitLines = gitData.commits.slice(0, 15).map(
        (c: any) => `${c.time || ''} ${c.message || ''}`
      );
      contextParts.push('Git commits on this day:\n' + commitLines.join('\n'));
    }

    const context = contextParts.join('\n\n');

    if (!context) {
      return new Response('No activity data found for this day.', { status: 200 });
    }

    // Single-pass summary with screen evidence
    const prompt = `You are an expert daily activity summarizer. You have access to a user's screen recordings — window titles, app usage times, accessibility-extracted text from their screen, semantic summaries of each capture, and git commit history. Your job is to reconstruct what they actually DID and ACCOMPLISHED, not just list what was open.

When a "Semantic:" line is provided for a capture, TRUST IT — it's a pre-analyzed description of what was happening. Use it as your primary signal for that workstream.

CRITICAL: You must INFER the specific work being done from the evidence:
- Window title "vector.rs — ritual-desktop-main — Modified" + app "Cursor" = "You edited the vector search implementation in \`vector.rs\`, working on the ritual-desktop project"
- Window title "Configure | Clerk.com" + app "Chrome" = "You configured authentication settings on Clerk.com"
- Git commits are the STRONGEST evidence — use commit messages to describe concrete outcomes
- OCR text reveals WHAT was on screen — use it to understand the actual content being worked on
- Multiple captures of the same app/file = extended focused session there

Date: ${dayOfWeek}, ${date}
${timezone ? `Timezone: ${timezone}` : ''}

=== HABIT METRICS ===
${metricsText}

=== SCREEN EVIDENCE ===
${context}

=== OUTPUT FORMAT ===
Write 3-6 workstreams. Each workstream has a **bold title**, a time range on the next line, then 1-3 sentences.

**Workstream Title**
*9:30 AM – 11:45 AM*
One to three sentences about what was specifically done. Only state what the evidence directly shows.

The time range should be derived from the timestamps in the screen evidence — use the earliest and latest timestamps for captures related to that workstream. Format as "*9:30 AM – 11:45 AM*" (italic, 12-hour, with en dash). If timestamps overlap across workstreams, that's fine — show each workstream's own range.

Rules:
- ONLY STATE WHAT THE EVIDENCE SHOWS. If you only know the user was on cloud.tinybird.co, say "You worked in the Tinybird console." Do NOT invent what they were doing there. One accurate sentence beats three speculative ones.
- NEVER SPECULATE OR PAD. These are all hallucination patterns — NEVER do any of them:
  Bad: "This work was essential for analyzing large volumes of data efficiently"
  Bad: "ensuring communication with colleagues and stakeholders was maintained"
  Bad: "which could support decision-making processes or inform further development efforts"
  Bad: "This activity was key to staying informed and connected, supporting your overall productivity"
  These sentences say NOTHING — they're generic filler that could apply to anyone on any day. DELETE THEM.
- If the evidence for a workstream is just an app name and a domain, write ONE sentence: "You used [app] on [domain]." That's it. Do not elaborate beyond what the evidence shows.
- INFER specifics ONLY when the evidence supports it: OCR text showing code, git commit messages, specific page titles, file names. These are real evidence. App name + domain alone is NOT enough to infer what was done.
- Group related activities into workstreams (e.g. all ritual-desktop file edits = one workstream)
- Order by significance (git commits and code edits first, browsing/email later)
- Use \`backticks\` for file names, commands, and technical terms
- BANNED phrases: "significant", "various", "likely", "possibly", "suggesting", "indicating", "engaged with", "explored", "essential for", "key to", "could support", "ensuring", "maintaining", "overall productivity", "further development", "informed and connected", "decision-making"
- NO emotional/productivity judgments ("productive day", "great progress")
- NO mentioning time durations in minutes/hours — focus on WHAT was done, not how long
- Second person ("You...")`;

    // Stream response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: prompt },
              { role: 'user', content: `Summarize my day on ${date}. Be specific about what was accomplished.` },
            ],
            stream: true,
            temperature: 0.3,
            max_tokens: 1200,
          });

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) controller.enqueue(encoder.encode(text));
          }

          controller.close();
        } catch (err) {
          console.error('📅 Stream error:', err);
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Calendar summary error:', error);
    return new Response('Failed to generate summary', { status: 500 });
  }
}
