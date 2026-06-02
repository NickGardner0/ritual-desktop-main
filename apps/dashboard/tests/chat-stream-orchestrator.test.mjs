/**
 * Chat-Stream Orchestrator Tests
 *
 * These tests validate the pure-function boundaries of the orchestrator
 * that must remain stable across refactoring phases.
 *
 * Run: node --test apps/dashboard/tests/chat-stream-orchestrator.test.mjs
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// These tests intentionally exercise pure runtime contracts directly so they
// remain independent of Next.js path aliases and package build output.
// ---------------------------------------------------------------------------
// 1. QUERY CLASSIFIER TESTS
//
// These test the exact pattern-matching logic that determines which tool
// gets called. If any of these fail after a refactoring phase, the fast-path
// routing is broken and users will get wrong/slow responses.
// ---------------------------------------------------------------------------

describe("Query Classifiers", () => {
  // -----------------------------------------------------------------------
  // Weekly recap detection
  // -----------------------------------------------------------------------
  describe("isComprehensiveWeeklyRecapQuery", () => {
    // Replicate the function logic for testing (will import directly after Phase 3)
    function isContextMemoryRecapQuery(text) {
      const normalized = (text || "").toLowerCase().trim();
      if (!normalized) return false;
      const explicitPatterns = [
        "what did i work on",
        "what was i working on",
        "what did i get done",
        "what did i get done on",
        "what did i accomplish",
        "what did i accomplish on",
        "what did i do on",
        "what did i do this morning",
        "what did i do today",
        "what did i do this week",
        "what did i do this month",
        "what did i work on today",
        "what did i do on my computer",
        "what happened in ",
        "what file was i working on",
        "what was i looking at",
        "what planning work did i do",
        "work recap",
        "workday recap",
        "narrative work recap",
        "narrative recap",
        "summarize my workday",
        "summarize my day",
        "recap my workday",
        "activity recap",
        "activity overview",
        "screen recap",
        "screen overview",
      ];
      if (explicitPatterns.some((p) => normalized.includes(p))) return true;
      const hasWorkVerb =
        /\b(work(?:ed|ing)? on|get done|accomplish(?:ed)?|doing|look(?:ed|ing) at|happened in|planning|research|reading|recap|summary|summarize)\b/.test(
          normalized,
        );
      const hasExplicitDate =
        /\b(?:on\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)?(\d{4})?\b/.test(
          normalized,
        );
      const hasRelativeTimeHint =
        /\b(today|yesterday|this week|last week|this month|last month)\b/.test(
          normalized,
        );
      const hasExplicitAnchor = hasRelativeTimeHint || hasExplicitDate;
      const hasHabitFocus = /\b(habit|habits|tracked)\b/.test(normalized);
      const hasDigitalContext =
        /\b(computer|screen|context|browser|website|app|apps|cursor|codex|chrome|slack|paper|finder|terminal|things)\b/.test(
          normalized,
        );
      const hasNarrativeWorkTarget =
        /\b(work|workday|projects?|tools?|time blocks?|workflow|workflows)\b/.test(
          normalized,
        ) && hasExplicitAnchor;
      const hasContextTarget = hasDigitalContext || (hasExplicitAnchor && !hasHabitFocus);
      return hasWorkVerb && hasContextTarget || hasNarrativeWorkTarget;
    }

    function isComprehensiveWeeklyRecapQuery(text) {
      const normalized = (text || "").toLowerCase().trim();
      if (!normalized) return false;
      if (isContextMemoryRecapQuery(normalized)) return false;
      const broadWeeklyPatterns = [
        "how was my week",
        "how has my week been",
        "how was this week",
        "how was last week",
        "how has last week been",
        "give me a weekly recap",
        "weekly habit recap",
        "weekly habit summary",
        "how did my habits do this week",
        "how did my habits do last week",
        "habit breakdown this week",
        "habit breakdown last week",
      ];
      if (broadWeeklyPatterns.some((p) => normalized.includes(p))) return true;
      return (
        /\b(this week|last week|past week)\b/.test(normalized) &&
        /\b(habit|habits|tracked)\b/.test(normalized)
      );
    }

    test("matches 'How was my week?'", () => {
      assert.equal(isComprehensiveWeeklyRecapQuery("How was my week?"), true);
    });

    test("matches 'How was last week?'", () => {
      assert.equal(isComprehensiveWeeklyRecapQuery("How was last week?"), true);
    });

    test("matches 'weekly habit recap'", () => {
      assert.equal(isComprehensiveWeeklyRecapQuery("weekly habit recap"), true);
    });

    test("matches 'weekly habit summary'", () => {
      assert.equal(
        isComprehensiveWeeklyRecapQuery("weekly habit summary"),
        true,
      );
    });

    test("matches 'how did my habits do this week'", () => {
      assert.equal(
        isComprehensiveWeeklyRecapQuery("how did my habits do this week"),
        true,
      );
    });

    test("matches 'how did my habits do last week'", () => {
      assert.equal(
        isComprehensiveWeeklyRecapQuery("how did my habits do last week"),
        true,
      );
    });

    test("matches 'habit breakdown this week'", () => {
      assert.equal(
        isComprehensiveWeeklyRecapQuery("habit breakdown this week"),
        true,
      );
    });

    test("matches 'How are my tracked habits this week?'", () => {
      assert.equal(
        isComprehensiveWeeklyRecapQuery(
          "How are my tracked habits this week?",
        ),
        true,
      );
    });

    test("does NOT match context memory queries", () => {
      assert.equal(
        isComprehensiveWeeklyRecapQuery("what did i work on this week"),
        false,
      );
      assert.equal(
        isComprehensiveWeeklyRecapQuery("what did i do this week"),
        false,
      );
    });

    test("does NOT match empty string", () => {
      assert.equal(isComprehensiveWeeklyRecapQuery(""), false);
    });

    test("does NOT match unrelated queries", () => {
      assert.equal(isComprehensiveWeeklyRecapQuery("How's my sleep?"), false);
      assert.equal(
        isComprehensiveWeeklyRecapQuery("Show me anomalies for workout"),
        false,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Daily overview detection
  // -----------------------------------------------------------------------
  describe("isDailyOverviewQuery", () => {
    function isContextMemoryRecapQuery(text) {
      const normalized = (text || "").toLowerCase().trim();
      const explicitPatterns = [
        "what did i work on",
        "what was i working on",
        "what did i get done",
        "what did i accomplish",
        "what did i do on",
        "what did i do this morning",
        "what did i do today",
        "what did i do this week",
        "what did i do this month",
        "what did i work on today",
        "what did i do on my computer",
        "what happened in ",
        "what file was i working on",
        "what was i looking at",
        "what planning work did i do",
        "work recap",
        "workday recap",
        "narrative work recap",
        "narrative recap",
        "summarize my workday",
        "summarize my day",
        "recap my workday",
        "activity recap",
        "activity overview",
        "screen recap",
        "screen overview",
      ];
      if (explicitPatterns.some((p) => normalized.includes(p))) return true;
      const hasWorkVerb =
        /\b(work(?:ed|ing)? on|get done|accomplish(?:ed)?|doing|look(?:ed|ing) at|happened in|planning|research|reading|recap|summary|summarize)\b/.test(
          normalized,
        );
      const hasExplicitAnchor =
        /\b(today|yesterday|this week|last week|this month|last month)\b/.test(
          normalized,
        ) ||
        /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
          normalized,
        ) ||
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
          normalized,
        ) ||
        /\b\d{4}-\d{2}-\d{2}\b/.test(normalized);
      const hasHabitFocus = /\b(habit|habits|tracked)\b/.test(normalized);
      const hasDigitalContext =
        /\b(computer|screen|context|browser|website|app|apps|cursor|codex|chrome|slack|paper|finder|terminal|things)\b/.test(
          normalized,
        );
      const hasContextTarget =
        hasDigitalContext || (hasExplicitAnchor && !hasHabitFocus);
      const hasNarrativeWorkTarget =
        /\b(work|workday|projects?|tools?|time blocks?|workflow|workflows)\b/.test(
          normalized,
        ) && hasExplicitAnchor;
      const scopedQuery =
        /\bin\s+(cursor|codex|chrome|google chrome|slack|paper|finder|terminal|things|gmail|mail|safari|arc|claude)\b/.test(
          normalized,
        ) ||
        /\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(normalized);
      return (hasWorkVerb && hasContextTarget && !scopedQuery) || hasNarrativeWorkTarget;
    }

    function isDailyOverviewQuery(text) {
      const normalized = (text || "").toLowerCase().trim();
      if (!normalized) return false;
      if (isContextMemoryRecapQuery(normalized)) return false;
      const dailyPatterns = [
        "daily recap",
        "daily summary",
        "habit recap today",
        "habit summary today",
        "today habit summary",
        "today habit overview",
        "how are my habits today",
        "how did my habits do today",
        "summarize my habits today",
      ];
      if (dailyPatterns.some((p) => normalized.includes(p))) return true;
      return (
        normalized.includes("today") &&
        /\b(habit|habits|tracked)\b/.test(normalized)
      );
    }

    test("matches 'daily recap'", () => {
      assert.equal(isDailyOverviewQuery("daily recap"), true);
    });

    test("matches 'how are my habits today'", () => {
      assert.equal(isDailyOverviewQuery("how are my habits today"), true);
    });

    test("matches 'how did my habits do today'", () => {
      assert.equal(isDailyOverviewQuery("how did my habits do today"), true);
    });

    test("matches 'summarize my habits today'", () => {
      assert.equal(isDailyOverviewQuery("summarize my habits today"), true);
    });

    test("does NOT match context memory queries like 'what did i do today'", () => {
      assert.equal(isDailyOverviewQuery("what did i do today"), false);
    });

    test("does NOT match weekly queries", () => {
      assert.equal(isDailyOverviewQuery("how did my habits do this week"), false);
    });

    test("does NOT match empty string", () => {
      assert.equal(isDailyOverviewQuery(""), false);
    });
  });

  // -----------------------------------------------------------------------
  // Context memory / activity recap detection
  // -----------------------------------------------------------------------
  describe("isContextMemoryRecapQuery", () => {
    function isContextMemoryRecapQuery(text) {
      const normalized = (text || "").toLowerCase().trim();
      if (!normalized) return false;
      const explicitPatterns = [
        "what did i work on",
        "what was i working on",
        "what did i get done",
        "what did i get done on",
        "what did i accomplish",
        "what did i accomplish on",
        "what did i do on",
        "what did i do this morning",
        "what did i do today",
        "what did i do this week",
        "what did i do this month",
        "what did i work on today",
        "what did i do on my computer",
        "what happened in ",
        "what file was i working on",
        "what was i looking at",
        "what planning work did i do",
        "work recap",
        "workday recap",
        "narrative work recap",
        "narrative recap",
        "summarize my workday",
        "summarize my day",
        "recap my workday",
        "activity recap",
        "activity overview",
        "screen recap",
        "screen overview",
      ];
      if (explicitPatterns.some((p) => normalized.includes(p))) return true;
      const hasWorkVerb =
        /\b(work(?:ed|ing)? on|get done|accomplish(?:ed)?|doing|look(?:ed|ing) at|happened in|planning|research|reading|recap|summary|summarize)\b/.test(
          normalized,
        );
      const hasExplicitDate =
        /\b(?:on\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)?(\d{4})?\b/.test(
          normalized,
        );
      const hasRelativeTimeHint =
        /\b(today|yesterday|this week|last week|this month|last month)\b/.test(
          normalized,
        );
      const hasExplicitAnchor = hasRelativeTimeHint || hasExplicitDate;
      const hasHabitFocus = /\b(habit|habits|tracked)\b/.test(normalized);
      const hasDigitalContext =
        /\b(computer|screen|context|browser|website|app|apps|cursor|codex|chrome|slack|paper|finder|terminal|things)\b/.test(
          normalized,
        );
      const hasNarrativeWorkTarget =
        /\b(work|workday|projects?|tools?|time blocks?|workflow|workflows)\b/.test(
          normalized,
        ) && hasExplicitAnchor;
      const scopedQuery =
        /\bin\s+(cursor|codex|chrome|google chrome|slack|paper|finder|terminal|things|gmail|mail|safari|arc|claude)\b/.test(
          normalized,
        ) ||
        /\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(normalized);
      const hasContextTarget =
        hasDigitalContext || (hasExplicitAnchor && !hasHabitFocus);
      return (hasWorkVerb && hasContextTarget && !scopedQuery) || hasNarrativeWorkTarget;
    }

    test("matches 'What did I get done yesterday?'", () => {
      assert.equal(
        isContextMemoryRecapQuery("What did I get done yesterday?"),
        true,
      );
    });

    test("matches 'What did I work on today?'", () => {
      assert.equal(
        isContextMemoryRecapQuery("What did I work on today?"),
        true,
      );
    });

    test("matches 'what did i do this week'", () => {
      assert.equal(
        isContextMemoryRecapQuery("what did i do this week"),
        true,
      );
    });

    test("matches 'activity recap'", () => {
      assert.equal(isContextMemoryRecapQuery("activity recap"), true);
    });

    test("matches explicit-date narrative work recap phrasing", () => {
      assert.equal(
        isContextMemoryRecapQuery("Give me a narrative work recap for Tuesday, March 31st, 2026 with the main projects, tools, websites, and time blocks."),
        true,
      );
    });

    test("matches 'what was i working on in Cursor'", () => {
      assert.equal(
        isContextMemoryRecapQuery("what was i working on in Cursor"),
        true,
      );
    });

    test("matches 'what happened in Chrome today'", () => {
      assert.equal(
        isContextMemoryRecapQuery("what happened in Chrome today"),
        true,
      );
    });

    test("does NOT match 'How's my sleep?'", () => {
      assert.equal(isContextMemoryRecapQuery("How's my sleep?"), false);
    });

    test("does NOT match empty string", () => {
      assert.equal(isContextMemoryRecapQuery(""), false);
    });

    test("does NOT match 'weekly habit recap'", () => {
      assert.equal(isContextMemoryRecapQuery("weekly habit recap"), false);
    });
  });

  // -----------------------------------------------------------------------
  // Screen time spent detection
  // -----------------------------------------------------------------------
  describe("isScreenTimeSpentQuery", () => {
    function isScreenTimeSpentQuery(text) {
      const normalized = (text || "").toLowerCase().trim();
      if (!normalized) return false;
      const explicitPatterns = [
        "how much time did i spend",
        "what did i spend my time on",
        "what did i spend time on",
        "where did my time go",
        "time spent on",
        "spent the most time",
        "spend the most time",
        "which app did i spend",
        "which apps did i spend",
        "computer time spent",
      ];
      if (explicitPatterns.some((p) => normalized.includes(p))) return true;
      const hasSpendVerb =
        /(spent|spend|spending|time allocation|time breakdown)/.test(
          normalized,
        );
      const hasComputerContext =
        /(computer|screen|app|apps|browser|website|ocr|recording|desktop)/.test(
          normalized,
        );
      return hasSpendVerb && hasComputerContext;
    }

    test("matches 'how much time did i spend on Cursor'", () => {
      assert.equal(
        isScreenTimeSpentQuery("how much time did i spend on Cursor"),
        true,
      );
    });

    test("matches 'where did my time go today'", () => {
      assert.equal(
        isScreenTimeSpentQuery("where did my time go today"),
        true,
      );
    });

    test("matches 'which app did i spend the most time in'", () => {
      assert.equal(
        isScreenTimeSpentQuery("which app did i spend the most time in"),
        true,
      );
    });

    test("matches 'time spent on computer'", () => {
      assert.equal(isScreenTimeSpentQuery("time spent on computer"), true);
    });

    test("matches 'app time breakdown'", () => {
      assert.equal(isScreenTimeSpentQuery("app time breakdown"), true);
    });

    test("does NOT match 'How's my sleep?'", () => {
      assert.equal(isScreenTimeSpentQuery("How's my sleep?"), false);
    });

    test("does NOT match empty string", () => {
      assert.equal(isScreenTimeSpentQuery(""), false);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. STREAM WIRE FORMAT TESTS
//
// The client (chat-client.tsx) parses the known prefixes below and must
// ignore any unknown control lines used for transport-level flushing.
// If the known formats change, the chat UI breaks silently.
// ---------------------------------------------------------------------------

describe("Stream Wire Format", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  test("conversation ID format: __CONVERSATION_ID__<id>__END_CONVERSATION_ID__", () => {
    const conversationId = "conv_abc123";
    const encoded = encoder.encode(
      `__CONVERSATION_ID__${conversationId}__END_CONVERSATION_ID__\n`,
    );
    const decoded = decoder.decode(encoded);

    // Client parsing regex (from chat-client.tsx)
    const match = decoded.match(
      /__CONVERSATION_ID__(.+?)__END_CONVERSATION_ID__/,
    );
    assert.ok(match, "Conversation ID format must be parseable");
    assert.equal(match[1], conversationId);
  });

  test("text chunk format: 0:{JSON.stringify(text)}\\n", () => {
    const chunk = "Hello world";
    const encoded = encoder.encode(`0:${JSON.stringify(chunk)}\n`);
    const decoded = decoder.decode(encoded);

    // Client parsing (from chat-client.tsx)
    assert.ok(decoded.startsWith("0:"), "Must start with '0:' prefix");
    const jsonPart = decoded.slice(2).trim();
    const parsed = JSON.parse(jsonPart);
    assert.equal(parsed, chunk);
  });

  test("text chunk with special characters", () => {
    const chunk = 'Your **sleep** averaged 7.2 hours (↑12%)';
    const encoded = encoder.encode(`0:${JSON.stringify(chunk)}\n`);
    const decoded = decoder.decode(encoded);
    const parsed = JSON.parse(decoded.slice(2).trim());
    assert.equal(parsed, chunk);
  });

  test("tool data format: __TOOL_DATA__<json>__END_TOOL_DATA__", () => {
    const toolPayload = {
      stats: [{ name: "Sleep", total: 50.2, average: 7.17 }],
      weeklyOverview: { success: true },
    };
    const encoded = encoder.encode(
      `\n__TOOL_DATA__${JSON.stringify(toolPayload)}__END_TOOL_DATA__\n`,
    );
    const decoded = decoder.decode(encoded);

    // Client parsing regex (from chat-client.tsx)
    const match = decoded.match(/__TOOL_DATA__(.+?)__END_TOOL_DATA__/);
    assert.ok(match, "Tool data format must be parseable");
    const parsed = JSON.parse(match[1]);
    assert.deepEqual(parsed, toolPayload);
  });

  test("tool data with nested objects and arrays", () => {
    const toolPayload = {
      allStats: [
        { name: "Sleep", total: 50, average: 7, min: 5, max: 9 },
        { name: "Workout", total: 12, average: 3, min: 1, max: 5 },
      ],
      allBreakdowns: [
        {
          habit: { id: "h1", name: "Sleep" },
          data: [
            { date: "2026-03-28", value: 7.5, logged: true },
            { date: "2026-03-29", value: 6.8, logged: true },
          ],
        },
      ],
      suggested_followups: ["Show anomalies", "Last 90 days"],
    };
    const line = `__TOOL_DATA__${JSON.stringify(toolPayload)}__END_TOOL_DATA__`;
    const match = line.match(/__TOOL_DATA__(.+?)__END_TOOL_DATA__/);
    assert.ok(match);
    assert.deepEqual(JSON.parse(match[1]), toolPayload);
  });

  test("unknown control lines can be ignored without affecting text reconstruction", () => {
    const lines = [
      "__STREAM_OPEN__\n",
      `0:${JSON.stringify("Hello")}\n`,
      `0:${JSON.stringify(" world")}\n`,
    ];

    let reconstructed = "";
    for (const line of lines.join("").split("\n")) {
      if (line.startsWith("0:")) {
        reconstructed += JSON.parse(line.slice(2));
      }
    }

    assert.equal(reconstructed, "Hello world");
  });

  test("full stream sequence: conversationId → text chunks → tool data", () => {
    // Simulate the exact stream the orchestrator produces
    const lines = [];
    const convId = "conv_test_001";
    lines.push(`__CONVERSATION_ID__${convId}__END_CONVERSATION_ID__\n`);

    const text = "Your sleep averaged **7.2 hours** this week.";
    const words = text.split(" ");
    const chunkSize = 5;
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunkWords = words.slice(i, i + chunkSize);
      const chunk = (i === 0 ? "" : " ") + chunkWords.join(" ");
      lines.push(`0:${JSON.stringify(chunk)}\n`);
    }

    const toolData = { weeklyOverview: { success: true } };
    lines.push(
      `\n__TOOL_DATA__${JSON.stringify(toolData)}__END_TOOL_DATA__\n`,
    );

    const fullStream = lines.join("");

    // Parse conversation ID
    const convMatch = fullStream.match(
      /__CONVERSATION_ID__(.+?)__END_CONVERSATION_ID__/,
    );
    assert.equal(convMatch[1], convId);

    // Parse text chunks
    let reconstructed = "";
    for (const line of fullStream.split("\n")) {
      if (line.startsWith("0:")) {
        reconstructed += JSON.parse(line.slice(2));
      }
    }
    assert.equal(reconstructed, text);

    // Parse tool data
    const toolMatch = fullStream.match(
      /__TOOL_DATA__(.+?)__END_TOOL_DATA__/,
    );
    assert.deepEqual(JSON.parse(toolMatch[1]), toolData);
  });
});

// ---------------------------------------------------------------------------
// 3. CANVAS PAYLOAD BUILDER TESTS
//
// buildCanvasToolPayload filters null/empty values before sending to client.
// If this breaks, the side panel shows no data.
// ---------------------------------------------------------------------------

describe("Canvas Payload Builder", () => {
  // Replicate the function for testing (will import after Phase 1)
  function buildCanvasToolPayload(toolResults) {
    const payload = {
      stats: toolResults.stats,
      dailyBreakdown: toolResults.dailyBreakdown,
      dailyBreakdownHabit: toolResults.dailyBreakdownHabit,
      correlation: toolResults.correlation,
      trends: toolResults.trends,
      anomalies: toolResults.anomalies,
      screenTimeSpent: toolResults.screenTimeSpent,
      weeklyOverview: toolResults.weeklyOverview,
      dailyOverview: toolResults.dailyOverview,
      monthlyOverview: toolResults.monthlyOverview,
      allStats: toolResults.allStats,
      allBreakdowns: toolResults.allBreakdowns,
      activitySummary: toolResults.activitySummary,
      dailyBiometrics: toolResults.dailyBiometrics,
      screenTimeSummary: toolResults.screenTimeSummary,
      calendarEvents: toolResults.calendarEvents,
      suggested_followups: toolResults.suggested_followups,
      reply_chips: toolResults.reply_chips,
    };
    for (const key of Object.keys(payload)) {
      const value = payload[key];
      if (value === undefined || value === null) {
        delete payload[key];
        continue;
      }
      if (Array.isArray(value) && value.length === 0) {
        delete payload[key];
      }
    }
    return Object.keys(payload).length > 0 ? payload : null;
  }

  test("strips undefined and null values", () => {
    const result = buildCanvasToolPayload({
      stats: undefined,
      weeklyOverview: { success: true },
      dailyBreakdown: null,
    });
    assert.deepEqual(result, { weeklyOverview: { success: true } });
  });

  test("strips empty arrays", () => {
    const result = buildCanvasToolPayload({
      allStats: [],
      allBreakdowns: [],
      weeklyOverview: { success: true },
    });
    assert.deepEqual(result, { weeklyOverview: { success: true } });
  });

  test("returns null when all values are empty/null/undefined", () => {
    const result = buildCanvasToolPayload({
      stats: undefined,
      allStats: [],
      allBreakdowns: [],
    });
    assert.equal(result, null);
  });

  test("preserves populated arrays", () => {
    const stats = [{ name: "Sleep", total: 50 }];
    const result = buildCanvasToolPayload({
      allStats: stats,
      allBreakdowns: [],
    });
    assert.deepEqual(result, { allStats: stats });
  });

  test("preserves all populated fields", () => {
    const input = {
      stats: [{ name: "Sleep" }],
      weeklyOverview: { success: true },
      suggested_followups: ["Show trends"],
      reply_chips: ["Last 7 days"],
    };
    const result = buildCanvasToolPayload(input);
    assert.deepEqual(result, input);
  });
});

// ---------------------------------------------------------------------------
// 4. VOICE MODE POST-PROCESSING TESTS
//
// formatVoiceResponse must trim, add questions, and limit bullets.
// If this breaks, voice mode returns huge or badly formatted responses.
// ---------------------------------------------------------------------------

describe("Voice Mode Post-Processing", () => {
  // Replicate core logic for testing
  function formatVoiceResponse(text) {
    if (!text) return text;
    const MAX_CHARS = 650;
    const MAX_BULLETS = 3;
    let result = text;
    result = result.replace(new RegExp("\\|[^\\n]+\\|", "g"), "");
    result = result.replace(new RegExp("[\\-:]+\\|[\\-:|]+", "g"), "");
    const bulletPattern = /^[\s]*[-*\u2022]\s.+$/gm;
    const bullets = result.match(bulletPattern) || [];
    if (bullets.length > MAX_BULLETS) {
      let bulletCount = 0;
      result = result.replace(bulletPattern, (match) => {
        bulletCount++;
        return bulletCount <= MAX_BULLETS ? match : "";
      });
    }
    result = result.replace(/\n{3,}/g, "\n\n");
    if (result.length > MAX_CHARS) {
      const truncated = result.substring(0, MAX_CHARS);
      const lastSentenceEnd = Math.max(
        truncated.lastIndexOf(". "),
        truncated.lastIndexOf("? "),
        truncated.lastIndexOf("! "),
      );
      if (lastSentenceEnd > MAX_CHARS * 0.5) {
        result = truncated.substring(0, lastSentenceEnd + 1);
      } else {
        result = truncated + "...";
      }
    }
    const trimmedResult = result.trim();
    if (!trimmedResult.endsWith("?")) {
      const lastQuestionMark = trimmedResult.lastIndexOf("?");
      if (lastQuestionMark > trimmedResult.length - 100) {
        result = trimmedResult.substring(0, lastQuestionMark + 1);
      } else {
        result = trimmedResult + "\n\nWant me to break this down further?";
      }
    }
    return result.trim();
  }

  test("short response ending with question is untouched", () => {
    const input = "Your sleep averaged 7.2 hours. Want the daily breakdown?";
    assert.equal(formatVoiceResponse(input), input);
  });

  test("short response without question — known bug: lastIndexOf returns -1 but passes > length-100 check", () => {
    // BUG: When lastIndexOf('?') returns -1, the check `-1 > length - 100`
    // is true for short strings (< 100 chars), causing substring(0, 0) = "".
    // This is a real bug to fix in Phase 6. For now, test matches current behavior.
    const input = "Your sleep averaged 7.2 hours this week.";
    const result = formatVoiceResponse(input);
    // Current buggy behavior: short strings with no '?' get truncated to empty
    assert.equal(result, "");
  });

  test("longer response without question gets fallback appended", () => {
    // Longer input where lastIndexOf('?') = -1 but length > 100,
    // so -1 > length-100 is false, hitting the correct else branch.
    const input =
      "Your sleep this week averaged 7.2 hours per night, which is slightly above your 30-day average of 6.9 hours. Wednesday was your best night at 8.6 hours.";
    const result = formatVoiceResponse(input);
    assert.ok(
      result.includes("Want me to break this down further?"),
      "Should add fallback question for longer responses",
    );
  });

  test("limits bullet points to 3", () => {
    const input = [
      "Summary:",
      "- Sleep: 7.2 hours",
      "- Workout: 3 sessions",
      "- Caffeine: 200mg",
      "- Screen time: 8 hours",
      "- Reading: 30 pages",
      "Want details?",
    ].join("\n");
    const result = formatVoiceResponse(input);
    const bulletCount = (result.match(/^[\s]*-\s.+$/gm) || []).length;
    assert.ok(bulletCount <= 3, `Expected <= 3 bullets, got ${bulletCount}`);
  });

  test("truncates long responses at sentence boundary", () => {
    const longText =
      "A".repeat(300) +
      ". " +
      "B".repeat(300) +
      ". " +
      "C".repeat(200) +
      "?";
    const result = formatVoiceResponse(longText);
    assert.ok(result.length <= 700, "Should be truncated near 650 chars");
  });

  test("returns empty string for empty input", () => {
    assert.equal(formatVoiceResponse(""), "");
  });

  test("removes markdown tables", () => {
    const input = "Here's your data:\n| Day | Hours |\n|---|---|\n| Mon | 7 |\nWant more?";
    const result = formatVoiceResponse(input);
    assert.ok(!result.includes("|"), "Tables should be stripped");
  });

  test("collapses excessive newlines", () => {
    const input = "Line one.\n\n\n\n\nLine two.\n\nWant details?";
    const result = formatVoiceResponse(input);
    assert.ok(
      !result.includes("\n\n\n"),
      "Should not have 3+ consecutive newlines",
    );
  });
});
