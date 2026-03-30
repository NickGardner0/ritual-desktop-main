/**
 * Context Memory Narrative Builder
 *
 * Extracted from orchestrator.ts (Phase 1) — builds the markdown narrative
 * that the LLM uses as grounding context when answering user questions about
 * their activity history.
 *
 * The main export is `buildContextMemoryNarrative`.  All helper functions are
 * private implementation details used only by the builder.
 */

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

export function formatNarrativeDateLabel(
  payload: { results?: Array<{ timestamp?: string }>; days_searched?: number },
  query: string,
  timezone?: string,
): string {
  const normalizedQuery = (query || '').toLowerCase();
  if (normalizedQuery.includes('this morning')) return 'This Morning';
  if (normalizedQuery.includes('this afternoon')) return 'This Afternoon';
  if (normalizedQuery.includes('this evening') || normalizedQuery.includes('tonight')) return 'This Evening';
  if (normalizedQuery.includes('today')) return 'Your Day So Far';

  const firstTimestamp = payload.results?.find((item) => item?.timestamp)?.timestamp;
  if (!firstTimestamp) {
    return payload.days_searched === 1 ? 'Recent Activity' : `Last ${payload.days_searched || 7} Days`;
  }

  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(firstTimestamp));
  return `Activity Summary (${label})`;
}

function clipContextText(value: unknown, limit = 160): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(limit - 3, 1)).trimEnd()}...`;
}

function formatContextTimestamp(value: unknown, timezone?: string): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatWorkstreamTimeRange(
  startTs: unknown,
  endTs: unknown,
  timezone?: string,
): string {
  const start = formatContextTimestamp(startTs, timezone);
  const end = formatContextTimestamp(endTs, timezone);
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end || '';
}

function renderWorkstreamSection(
  item: any,
  timezone?: string,
): string[] {
  const sectionLines: string[] = [];
  const label = clipContextText(item?.label || item?.title || 'Workstream', 120);
  const timeRange = formatWorkstreamTimeRange(item?.start_ts, item?.end_ts, timezone);
  const seqNum = item?.sequence_number || 0;
  const interactionLevel = item?.interaction_level || 'present';

  // For brief passive visits, render a single concise line instead of a full section
  if (interactionLevel === 'passive_brief') {
    const apps = Array.isArray(item?.apps) ? item.apps : [];
    const appName = apps[0] || label;
    const briefLine = seqNum > 0
      ? `${seqNum}. Briefly checked ${appName}`
      : `- Briefly checked ${appName}`;
    if (timeRange) {
      sectionLines.push(`${briefLine} *(${timeRange})*`);
    } else {
      sectionLines.push(briefLine);
    }
    return sectionLines;
  }

  // For task manager items without corroborating artifacts, use "viewed tasks" language
  if (interactionLevel === 'task_viewed') {
    const apps = Array.isArray(item?.apps) ? item.apps : [];
    const appName = apps[0] || label;
    const specificTasks = Array.isArray(item?.specific_tasks) ? item.specific_tasks : [];
    const taskDetail = specificTasks.length > 0
      ? `: "${clipContextText(specificTasks[0], 120)}"`
      : '';
    const viewedLine = seqNum > 0
      ? `${seqNum}. Viewed/added tasks in ${appName}${taskDetail}`
      : `- Viewed/added tasks in ${appName}${taskDetail}`;
    if (timeRange) {
      sectionLines.push(`${viewedLine} *(${timeRange})*`);
    } else {
      sectionLines.push(viewedLine);
    }
    return sectionLines;
  }

  // Bold heading (not markdown ### — avoids LLM passing through as section headers)
  const heading = `**${label}**`;
  sectionLines.push(heading);
  if (timeRange) {
    sectionLines.push(`*${timeRange}*`);
  }

  // Canonical identity context (repo/branch) — gives grounding like Littlebird
  const repoRoot = item?.repo_root ? String(item.repo_root).split('/').pop() || '' : '';
  const branch = item?.branch || '';
  if (repoRoot && branch) {
    sectionLines.push(`*${repoRoot} — ${branch}*`);
  } else if (repoRoot) {
    sectionLines.push(`*${repoRoot}*`);
  }

  // Collect all evidence into a structured block for LLM synthesis
  const specificTasks = Array.isArray(item?.specific_tasks) ? item.specific_tasks : [];
  const files = Array.isArray(item?.file_artifacts) ? item.file_artifacts : [];
  const commands = Array.isArray(item?.command_artifacts) ? item.command_artifacts : [];
  const commits = Array.isArray(item?.commit_artifacts) ? item.commit_artifacts : [];
  const gitOps = Array.isArray(item?.git_op_artifacts) ? item.git_op_artifacts : [];
  const errors = Array.isArray(item?.error_artifacts) ? item.error_artifacts : [];
  const taskDocs = Array.isArray(item?.task_doc_artifacts) ? item.task_doc_artifacts : [];
  const apps = Array.isArray(item?.apps) ? item.apps : [];
  const confidence = item?.confidence || 0;
  const durationMs = item?.duration_ms || 0;
  const durationMin = durationMs > 0 ? Math.round(durationMs / 60000) : 0;

  // Provide evidence as a synthesis block — the LLM weaves these into prose
  sectionLines.push('[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');

  if (specificTasks.length > 0) {
    sectionLines.push(`Activities: ${specificTasks.slice(0, 6).map((t: string) => clipContextText(t, 160)).join(' | ')}`);
  }

  if (files.length > 0) {
    sectionLines.push(`Files modified: ${files.slice(0, 10).map((f: string) => `\`${f}\``).join(', ')}`);
  }

  if (commands.length > 0) {
    sectionLines.push(`Commands: ${commands.slice(0, 5).map((c: string) => `\`${c}\``).join(', ')}`);
  }

  const allGit = [...commits.slice(0, 3), ...gitOps.slice(0, 3)];
  if (allGit.length > 0) {
    sectionLines.push(`Git activity: ${allGit.map((g: string) => clipContextText(g, 80)).join(', ')}`);
  }

  if (errors.length > 0) {
    sectionLines.push(`Errors encountered: ${errors.slice(0, 3).map((e: string) => clipContextText(e, 140)).join('; ')}`);
  }

  if (taskDocs.length > 0) {
    sectionLines.push(`Task references: ${taskDocs.slice(0, 3).join(', ')}`);
  }

  if (apps.length > 0) {
    sectionLines.push(`Apps: ${apps.join(', ')}`);
  }

  if (durationMin > 0) {
    sectionLines.push(`Duration: ~${durationMin} min`);
  }

  if (confidence > 0 && confidence < 0.5) {
    sectionLines.push(`Note: low confidence (${(confidence * 100).toFixed(0)}%) — use cautious language`);
  }

  sectionLines.push('[END EVIDENCE]');

  return sectionLines;
}

function getWorkstreamSortTimestamp(item: any): number {
  const startTs = Number(item?.start_ts || 0);
  const endTs = Number(item?.end_ts || 0);
  if (Number.isFinite(startTs) && startTs > 0) return startTs;
  if (Number.isFinite(endTs) && endTs > 0) return endTs;
  return Number.MAX_SAFE_INTEGER;
}

function sortWorkstreamsChronologically(items: any[]): any[] {
  return [...items].sort((a: any, b: any) => {
    const aTs = getWorkstreamSortTimestamp(a);
    const bTs = getWorkstreamSortTimestamp(b);
    if (aTs !== bTs) return aTs - bTs;

    const aEnd = Number(a?.end_ts || 0);
    const bEnd = Number(b?.end_ts || 0);
    if (aEnd !== bEnd) return aEnd - bEnd;

    const aSeq = Number(a?.sequence_number || 0);
    const bSeq = Number(b?.sequence_number || 0);
    return aSeq - bSeq;
  });
}

function getNarrativeWorkstreamLimit(query: string, rendererKind: string): number {
  const normalized = (query || '').toLowerCase();
  if (
    rendererKind === 'daypart_overview'
    || rendererKind === 'broad_overview'
    || /\b(what did i (work on|do|get done)|activity summary|recap)\b/.test(normalized)
  ) {
    return 12;
  }
  return 8;
}

function _dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function buildContextMemoryNarrative(
  payload: any,
  query: string,
  timezone?: string,
): string {
  if (!payload?.success) {
    return payload?.error || 'I could not retrieve context memory for that question.';
  }

  const storyPlan = payload.story_plan || {};
  const renderer = payload.renderer || storyPlan.renderer || {};
  const rendererKind = renderer.kind || storyPlan.renderer_kind || 'topic_lookup';
  const results = Array.isArray(payload.results) ? payload.results : [];
  const mainEvent = storyPlan.main_event || null;
  const claimCards = Array.isArray(storyPlan.claim_cards) ? storyPlan.claim_cards : [];
  const supporting = Array.isArray(storyPlan.supporting_workstreams) ? storyPlan.supporting_workstreams : [];
  const researchBrowsing = Array.isArray(storyPlan.research_browsing) ? storyPlan.research_browsing : [];
  const personalActivity = Array.isArray(storyPlan.personal_activity) ? storyPlan.personal_activity : [];
  const tasks = Array.isArray(storyPlan.concrete_tasks_completed) ? storyPlan.concrete_tasks_completed : [];
  const documents = Array.isArray(storyPlan.document_items) ? storyPlan.document_items : [];
  const strongestEvidence = Array.isArray(storyPlan.strongest_evidence) ? storyPlan.strongest_evidence : [];
  const apps = Array.isArray(storyPlan.apps_and_tools_used) ? storyPlan.apps_and_tools_used : [];
  const timelineSegments = Array.isArray(storyPlan.timeline_segments) ? storyPlan.timeline_segments : [];
  const uncertainty = Array.isArray(storyPlan.uncertainty_or_conflicts) ? storyPlan.uncertainty_or_conflicts : [];
  const numberedWorkstreams = Array.isArray(storyPlan.numbered_workstreams) ? storyPlan.numbered_workstreams : [];
  const corroboratingActivity = Array.isArray(storyPlan.corroborating_activity) ? storyPlan.corroborating_activity : [];
  const filesTouched = Array.isArray(storyPlan.files_touched) ? storyPlan.files_touched : [];
  const commandsRun = Array.isArray(storyPlan.commands_run) ? storyPlan.commands_run : [];
  const errorsEncountered = Array.isArray(storyPlan.errors_encountered) ? storyPlan.errors_encountered : [];
  const commitsAndPushes = Array.isArray(storyPlan.commits_and_pushes) ? storyPlan.commits_and_pushes : [];
  const heading = formatNarrativeDateLabel(payload, query, timezone);
  const maxWorkstreamsToRender = getNarrativeWorkstreamLimit(query, rendererKind);
  const lines: string[] = [`## ${heading}`];

  if (!mainEvent && results.length === 0) {
    if (payload.message) lines.push('', payload.message);
    return lines.join('\n');
  }

  // --- App Drilldown: Numbered workstream rendering ---
  if (rendererKind === 'app_drilldown') {
    const appName = Array.isArray(mainEvent?.apps) && mainEvent.apps.length > 0
      ? String(mainEvent.apps[0])
      : results[0]?.app_name || 'that app';

    // Compute overall time range from ALL workstreams (not just main event)
    const allWorkstreams = numberedWorkstreams.length > 0
      ? numberedWorkstreams
      : [mainEvent, ...supporting].filter(Boolean);
    let minTs = mainEvent?.start_ts || 0;
    let maxTs = mainEvent?.end_ts || 0;
    for (const ws of allWorkstreams) {
      if (ws?.start_ts && (!minTs || ws.start_ts < minTs)) minTs = ws.start_ts;
      if (ws?.end_ts && ws.end_ts > maxTs) maxTs = ws.end_ts;
    }
    const overallTimeRange = formatWorkstreamTimeRange(minTs || undefined, maxTs || undefined, timezone);
    if (overallTimeRange) {
      lines.push('', `**${appName} (${overallTimeRange})**`);
    } else {
      lines.push('', `**${appName}**`);
    }

    // Render numbered workstreams
    const workstreamsToRender = sortWorkstreamsChronologically(numberedWorkstreams.length > 0
      ? numberedWorkstreams.filter((ws: any) => ws?.label && ws.label !== 'General workstream')
      : [mainEvent, ...supporting].filter(Boolean));

    for (const item of workstreamsToRender.slice(0, maxWorkstreamsToRender)) {
      lines.push('');
      lines.push(...renderWorkstreamSection(item, timezone));
    }

    // If no workstreams had files but we have top-level files, show them
    const workstreamHasFiles = workstreamsToRender.some((ws: any) =>
      Array.isArray(ws?.file_artifacts) && ws.file_artifacts.length > 0
    );
    if (!workstreamHasFiles && filesTouched.length > 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Files modified: ${filesTouched.slice(0, 10).map((f: string) => `\`${f}\``).join(', ')}`);
      lines.push('[END EVIDENCE]');
    }

    // Corroborating activity from other apps
    const terminalCorr = corroboratingActivity.filter((c: any) => c?.kind === 'terminal');
    const browserCorr = corroboratingActivity.filter((c: any) => c?.kind === 'browser');
    const hasGitOps = commitsAndPushes.length > 0;
    const hasCorr = terminalCorr.length > 0 || browserCorr.length > 0 || hasGitOps || errorsEncountered.length > 0;

    if (hasCorr) {
      lines.push('', '[ADDITIONAL EVIDENCE — weave into workstream narratives where relevant]');
      if (terminalCorr.length > 0) {
        const termCmds = _dedupeStrings(terminalCorr.flatMap((c: any) => c?.commands || []).concat(commandsRun)).slice(0, 6);
        if (termCmds.length > 0) {
          lines.push(`Terminal commands: ${termCmds.map((c: string) => `\`${c}\``).join(', ')}`);
        }
      }
      if (browserCorr.length > 0) {
        const browserSnippets = browserCorr.slice(0, 3).map((c: any) => {
          const domain = c?.domain || '';
          const snippet = clipContextText(c?.snippet || '', 80);
          return domain ? `${domain} (${snippet})` : snippet;
        }).filter(Boolean);
        if (browserSnippets.length > 0) {
          lines.push(`Browser research: ${browserSnippets.join(', ')}`);
        }
      }
      if (hasGitOps) {
        lines.push(`Git activity: ${commitsAndPushes.slice(0, 4).join(', ')}`);
      }
      if (errorsEncountered.length > 0) {
        for (const err of errorsEncountered.slice(0, 3)) {
          lines.push(`Error: ${clipContextText(err, 140)}`);
        }
      }
      lines.push('[END ADDITIONAL EVIDENCE]');
    }

    // Documents — included as evidence for the LLM to weave into narrative
    if (documents.length > 0 && filesTouched.length === 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Documents: ${documents.slice(0, 5).map((d: any) => clipContextText(d?.label || d?.title || 'Document', 160)).join(', ')}`);
      lines.push('[END EVIDENCE]');
    }

  // --- Daypart/Broad Overview: Numbered workstream rendering ---
  } else if (rendererKind === 'daypart_overview' || rendererKind === 'broad_overview') {
    // Provide claim cards as high-level narrative seeds for the LLM
    const relevantClaims = claimCards.filter((card: any) =>
      card?.claim_text && card.claim_kind !== 'uncertainty'
    );
    if (relevantClaims.length > 0) {
      lines.push('', '[NARRATIVE SEEDS — use these to frame the overall summary]');
      for (const card of relevantClaims.slice(0, 5)) {
        const conf = card.confidence ? ` (confidence: ${(card.confidence * 100).toFixed(0)}%)` : '';
        lines.push(`- ${clipContextText(card.claim_text, 200)}${conf}`);
      }
      lines.push('[END NARRATIVE SEEDS]');
    }

    // Render numbered workstreams for overview too
    const workstreamsToRender = numberedWorkstreams.length > 0
      ? numberedWorkstreams.filter((ws: any) => ws?.label && ws.label !== 'General workstream')
      : [mainEvent, ...supporting].filter(Boolean);

    const overviewWorkstreams = sortWorkstreamsChronologically(
      [...workstreamsToRender, ...researchBrowsing, ...personalActivity].filter(Boolean),
    );

    for (const item of overviewWorkstreams.slice(0, maxWorkstreamsToRender)) {
      lines.push('');
      lines.push(...renderWorkstreamSection(item, timezone));
    }

    // Corroborating activity from terminal/browser
    const terminalCorr = corroboratingActivity.filter((c: any) => c?.kind === 'terminal');
    const browserCorr = corroboratingActivity.filter((c: any) => c?.kind === 'browser');
    const hasCorr = terminalCorr.length > 0 || browserCorr.length > 0 || commitsAndPushes.length > 0 || commandsRun.length > 0;

    if (hasCorr) {
      lines.push('', '[ADDITIONAL EVIDENCE — weave into workstream narratives where relevant]');
      if (terminalCorr.length > 0) {
        const termCmds = _dedupeStrings(terminalCorr.flatMap((c: any) => c?.commands || []).concat(commandsRun)).slice(0, 6);
        if (termCmds.length > 0) {
          lines.push(`Terminal commands: ${termCmds.map((c: string) => `\`${c}\``).join(', ')}`);
        }
      }
      if (browserCorr.length > 0) {
        const browserSnippets = browserCorr.slice(0, 3).map((c: any) => {
          const domain = c?.domain || '';
          const snippet = clipContextText(c?.snippet || '', 80);
          return domain ? `${domain} (${snippet})` : snippet;
        }).filter(Boolean);
        if (browserSnippets.length > 0) {
          lines.push(`Browser research: ${browserSnippets.join(', ')}`);
        }
      }
      if (commitsAndPushes.length > 0) {
        lines.push(`Git activity: ${commitsAndPushes.slice(0, 4).join(', ')}`);
      }
      lines.push('[END ADDITIONAL EVIDENCE]');
    }

    // Uncertainty / caveats
    if (uncertainty.length > 0) {
      lines.push('', '[CAVEATS — mention these honestly in your summary]');
      for (const u of uncertainty.slice(0, 3)) {
        lines.push(`- ${clipContextText(u, 160)}`);
      }
      lines.push('[END CAVEATS]');
    }

  // --- Topic lookup / default ---
  } else {
    const mainClaim =
      claimCards.find((card: any) => card?.claim_kind === 'main_event')?.claim_text
      || claimCards[0]?.claim_text
      || (mainEvent?.label ? `The main thread was ${mainEvent.label}.` : '');

    if (mainEvent?.label) {
      lines.push('', `**${mainEvent.label}**`);
    }
    if (mainClaim) {
      lines.push('', clipContextText(mainClaim, 240));
    }

    if (supporting.length > 0) {
      for (const item of supporting.slice(0, 3)) {
        lines.push('');
        lines.push(...renderWorkstreamSection(item, timezone));
      }
    }

    if (tasks.length > 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Completed tasks: ${tasks.slice(0, 5).map((t: string) => clipContextText(t, 140)).join(', ')}`);
      lines.push('[END EVIDENCE]');
    } else if (documents.length > 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Documents: ${documents.slice(0, 4).map((d: any) => clipContextText(d?.label || d?.title || 'Document', 140)).join(', ')}`);
      lines.push('[END EVIDENCE]');
    }
  }

  // Apps list and strongest evidence are available in per-workstream evidence blocks —
  // no separate sections needed. The LLM weaves these into narrative naturally.

  if (uncertainty.length > 0) {
    lines.push('', `*${clipContextText(uncertainty[0], 160)}*`);
  }

  return lines.join('\n');
}
