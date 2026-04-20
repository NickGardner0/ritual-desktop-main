// @ts-nocheck

const WEEKDAY_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const COMPUTER_ACTIVITY_HABIT_ALIASES = new Set([
  "computer use",
  "computer activity",
  "computer time",
]);
const COMPUTER_TIME_DISPLAY_NAME = "Computer Time";
const HABIT_DISPLAY_ALIASES = {
  "caffeine consumption": "Caffeine",
  "nicotine consumption": "Nicotine",
};

function normalizeHabitName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getHabitDisplayName(name) {
  const normalized = normalizeHabitName(name);
  return COMPUTER_ACTIVITY_HABIT_ALIASES.has(normalized)
    ? COMPUTER_TIME_DISPLAY_NAME
    : HABIT_DISPLAY_ALIASES[normalized] || String(name || "");
}

function toYmdUtc(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTimezoneDateParts(now, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const weekdayRaw = (map.weekday || "Mon").slice(0, 3).toLowerCase();
  const weekday = WEEKDAY_INDEX[weekdayRaw] ?? 1;

  return { year, month, day, weekday };
}

export function getStrictThisWeekRange(timezone, now = new Date()) {
  const { year, month, day, weekday } = getTimezoneDateParts(now, timezone);
  // Anchor to noon UTC to avoid DST edge artifacts when subtracting dates.
  const tzDateAnchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const daysFromMonday = (weekday + 6) % 7;
  const weekStartAnchor = new Date(tzDateAnchor);
  weekStartAnchor.setUTCDate(weekStartAnchor.getUTCDate() - daysFromMonday);

  return {
    startDate: toYmdUtc(weekStartAnchor),
    endDate: toYmdUtc(tzDateAnchor),
  };
}

export function buildWeeklyOverviewCanvasPayload({
  startDate,
  endDate,
  days,
  allHabits,
  overviewHabits,
  dailyByHabitId,
  watcherDailyRows,
  topApps,
  topDomains,
}) {
  const allHabitsWithDataRaw = (allHabits || []).filter(
    (habit) => Number(habit.days_with_data || 0) > 0,
  );
  const habitsWithDataRaw = (overviewHabits || allHabitsWithDataRaw).filter(
    (habit) => Number(habit.days_with_data || 0) > 0,
  );

  const normalizedWatcherDaily = (watcherDailyRows || []).map((row) => {
    const activeHoursRaw =
      typeof row.active_hours === "number"
        ? row.active_hours
        : typeof row.total_active_ms === "number"
          ? row.total_active_ms / (1000 * 60 * 60)
          : 0;

    return {
      day: String(row.day || ""),
      active_hours: Number(activeHoursRaw || 0),
      events_count: Number(row.events_count || row.total_events || 0),
      apps_count: Number(row.apps_count || 0),
    };
  });

  const watcherActiveDays = normalizedWatcherDaily.filter(
    (row) => row.active_hours > 0,
  );
  const hasWatcherComputerData =
    watcherActiveDays.length > 0 ||
    (Array.isArray(topApps) && topApps.length > 0) ||
    (Array.isArray(topDomains) && topDomains.length > 0);

  // If watcher activity exists, avoid duplicating the same concept via manual computer habits.
  const habitsWithData = hasWatcherComputerData
    ? habitsWithDataRaw.filter(
        (habit) =>
          !COMPUTER_ACTIVITY_HABIT_ALIASES.has(
            normalizeHabitName(habit?.name),
          ),
      )
    : habitsWithDataRaw;

  const habits = habitsWithData.map((habit) => ({
    ...habit,
    name: getHabitDisplayName(habit?.name),
    daily: dailyByHabitId.get(habit.id) || [],
  }));

  const totalComputerHours = watcherActiveDays.reduce(
    (sum, row) => sum + row.active_hours,
    0,
  );
  const minComputerHours =
    watcherActiveDays.length > 0
      ? Math.min(...watcherActiveDays.map((row) => row.active_hours))
      : 0;
  const maxComputerHours =
    watcherActiveDays.length > 0
      ? Math.max(...watcherActiveDays.map((row) => row.active_hours))
      : 0;

  return {
    success: true,
    date_range: {
      start: startDate,
      end: endDate,
      days,
    },
    summary: {
      habits_with_data: allHabitsWithDataRaw.length,
      total_habits_tracked: (allHabits || []).length,
    },
    habits,
    computer_activity: {
      days_with_data: watcherActiveDays.length,
      total_hours: Number(totalComputerHours.toFixed(2)),
      average_daily_hours:
        watcherActiveDays.length > 0
          ? Number((totalComputerHours / watcherActiveDays.length).toFixed(2))
          : 0,
      min_daily_hours: Number(minComputerHours.toFixed(2)),
      max_daily_hours: Number(maxComputerHours.toFixed(2)),
      daily: normalizedWatcherDaily,
      top_apps: Array.isArray(topApps) ? topApps : [],
      top_domains: Array.isArray(topDomains) ? topDomains : [],
    },
    suggested_followups: [
      "Show me screen activity details for this week",
      "Compare this week vs last week",
      "Which habit changed the most?",
    ],
  };
}
