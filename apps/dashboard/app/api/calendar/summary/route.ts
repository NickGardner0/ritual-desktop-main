import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';
import { getServerBackendBaseUrl } from '@/lib/api/server-client';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

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

    const normalizedHabitMetrics = Array.isArray(habitMetrics)
      ? habitMetrics
          .map((metric) => ({
            name: String(metric?.name || '').trim(),
            value: String(metric?.value || '').trim(),
          }))
          .filter((metric) => metric.name && metric.value)
      : [];
    const hasHabitMetrics = normalizedHabitMetrics.length > 0;
    const metricsText = hasHabitMetrics
      ? normalizedHabitMetrics.map((m) => `${m.name}: ${m.value}`).join('\n')
      : 'No habit data logged.';

    // Fetch compact project-time attribution plus app/domain context. Raw OCR/accessibility
    // snippets are intentionally excluded from the cloud summary path.
    const params = new URLSearchParams({
      start_date: date,
      end_date: date,
      limit: '8',
    });
    const sessionParams = new URLSearchParams({
      start_date: date,
      end_date: date,
      limit: '24',
    });

    const backendBaseUrl = getServerBackendBaseUrl();
    const [projectRollups, projectSessions, appsData, domainsData, gitData] = await Promise.all([
      fetch(
        `${backendBaseUrl}/api/watcher/project-time/rollups?${params}&group_by=task`,
        { headers, signal: AbortSignal.timeout(8000) }
      )
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`${backendBaseUrl}/api/watcher/project-time/sessions?${sessionParams}`, {
        headers,
        signal: AbortSignal.timeout(8000),
      })
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`${backendBaseUrl}/api/watcher/stats/top-apps?${params}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      })
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`${backendBaseUrl}/api/watcher/stats/top-domains?${params}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      })
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      // Git commit history for the day — shows what was actually accomplished in code
      fetch(
        `${backendBaseUrl}/api/watcher/git-commits?date=${date}`,
        { headers, signal: AbortSignal.timeout(5000) }
      )
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]);

    // Build context
    const contextParts: string[] = [];

    if (projectRollups?.success && Array.isArray(projectRollups.data) && projectRollups.data.length > 0) {
      const rollupLines = projectRollups.data.slice(0, 12).map((row: any) => {
        const project = row.project_name || 'Unclassified';
        const task = row.task_name || 'General';
        const ms = Number(row.active_ms || 0);
        const confidence = Number(row.confidence_avg || 0);
        return `${project} / ${task}: ${formatMs(ms)}${confidence > 0 ? `, confidence ${Math.round(confidence * 100)}%` : ''}`;
      });
      contextParts.push('Project/task time rollups:\n' + rollupLines.join('\n'));
    }

    if (projectSessions?.success && Array.isArray(projectSessions.data) && projectSessions.data.length > 0) {
      const sessionLines = projectSessions.data.slice(0, 18).map((session: any) => {
        const started = new Date(Number(session.start_ts || 0));
        const ended = new Date(Number(session.end_ts || 0));
        const timeRange = !Number.isNaN(started.getTime()) && !Number.isNaN(ended.getTime())
          ? `${started.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              ...(timezone ? { timeZone: timezone } : {}),
            })}-${ended.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              ...(timezone ? { timeZone: timezone } : {}),
            })}`
          : 'Unknown time';
        const apps = Array.isArray(session.apps)
          ? session.apps.slice(0, 3).map((item: any) => item.name).filter(Boolean).join(', ')
          : '';
        const domains = Array.isArray(session.domains)
          ? session.domains.slice(0, 3).map((item: any) => item.name).filter(Boolean).join(', ')
          : '';
        const appDomain = [apps ? `apps: ${apps}` : '', domains ? `domains: ${domains}` : ''].filter(Boolean).join('; ');
        return `${timeRange}: ${session.project_name || 'Unclassified'} / ${session.task_name || 'General'} (${formatMs(Number(session.active_ms || 0))}${appDomain ? `; ${appDomain}` : ''})`;
      });
      if (sessionLines.length) {
        contextParts.push('Project/task sessions:\n' + sessionLines.join('\n'));
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

    const hasActivityEvidence = Boolean(context);

    if (!hasActivityEvidence && !hasHabitMetrics) {
      return new Response('No activity data found for this day.', { status: 200 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return new Response('Calendar summary is not configured on this deployment.', {
        status: 503,
      });
    }

    const activityEvidenceText = hasActivityEvidence
      ? context
      : 'No project-time, app, website, or git evidence was available for this day. Use only the habit metrics.';

    // Single-pass summary with whatever evidence is available.
    const prompt = `You are an expert daily activity summarizer. You have access to a user's habit metrics and, when available, compact local project/task time attribution, app usage times, website usage times, and git commit history. Your job is to summarize what the evidence actually supports.

Project/task attribution is generated locally from app, window, domain, and short safe artifact signals. Treat it as the primary computer-work signal. Do not refer to raw capture internals.

CRITICAL: Use compact project/task rows to describe the specific workstreams:
- Project/task rollups show what work was attributed and for how long.
- Project/task sessions show when a workstream happened and the apps/domains involved.
- Git commits are strong evidence of concrete coding outcomes.
- App/domain usage can support the summary but should not override explicit project/task attribution.

Date: ${dayOfWeek}, ${date}
${timezone ? `Timezone: ${timezone}` : ''}

=== HABIT METRICS ===
${metricsText}

=== ACTIVITY EVIDENCE ===
${activityEvidenceText}

=== OUTPUT FORMAT ===
If project-time sessions, app/domain usage, or git commits are available, write 3-6 workstreams. Each workstream has a **bold title**, a time range on the next line, then 1-3 sentences.

**Workstream Title**
*9:30 AM – 11:45 AM*
One to three sentences about what was specifically done. Only state what the evidence directly shows.

The time range should be derived from project-time session timestamps. Format as "*9:30 AM – 11:45 AM*" (italic, 12-hour, with en dash). If timestamps overlap across workstreams, that's fine — show each workstream's own range.

If only habit metrics are available, do not create workstreams or time ranges. Write 2-4 short factual lines that summarize the logged metrics only. Do not infer activities, accomplishments, productivity, or intent from metrics alone.

Rules:

EVIDENCE QUALITY TIERS — match your confidence and detail to the evidence strength:

RICH EVIDENCE (project/task labels with high confidence, git commit messages, safe artifact/file names, specific app/domain combinations):
→ Write detailed, confident narrative. Name specific files, quote commit messages, describe what the code change accomplishes. Be assertive — this evidence is trustworthy.
→ Example: "You updated \`project_time.rs\` to recompute daily task rollups, and your commit 'add project-time rollup sync' confirmed the work landed."

MODERATE EVIDENCE (project/task labels with medium confidence, domain + app combinations, safe document/repo names):
→ Write specific but measured statements. Describe what was visible and what the work likely involved.
→ Example: "You worked in the Tinybird console, navigating the data sources and query editor for the analytics pipeline."

THIN EVIDENCE (just app name + domain, no project labels, no file paths):
→ Write ONE factual sentence. Do not elaborate or speculate.
→ Example: "You used Chrome on cloud.tinybird.co."

CROSS-APP PROJECT THREADING: The evidence is in chronological order. When project/task sessions from DIFFERENT apps/domains are adjacent and share the same project or task, thread them into ONE workstream. Derive the workstream title from the shared project/task, not from any single app.

- NEVER PAD WITH GENERIC FILLER. These patterns say NOTHING — delete them:
  Bad: "This work was essential for analyzing large volumes of data efficiently"
  Bad: "ensuring communication with colleagues and stakeholders was maintained"
  Bad: "which could support decision-making processes"
  Bad: "This activity was key to staying informed and connected"
- Group related activities into workstreams by PROJECT, not by app
- Order by significance (git commits and code edits first, browsing/email later)
- Use \`backticks\` for file names, commands, and technical terms
- BANNED phrases: "significant", "various", "possibly", "engaged with", "essential for", "key to", "could support", "ensuring", "maintaining", "overall productivity", "further development", "informed and connected", "decision-making", "spent time in"
- NO emotional/productivity judgments ("productive day", "great progress")
- NO mentioning time durations in minutes/hours — focus on WHAT was done, not how long
- Second person ("You...")`;

    // Stream response
    const encoder = new TextEncoder();
    const openai = getOpenAIClient();
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
