export type SuggestionMode = 'log' | 'chat'

export interface ChatSuggestion {
  text: string
  type: 'habit' | 'question' | 'log_phrase'
  habit_id?: string
  habit_name?: string
  unit_type?: string
  icon?: string
  value?: number
  hint?: string
  score?: number
  source?: 'local' | 'server'
}

interface SuggestionHabit {
  id?: string
  name: string
  unit_type?: string | null
  category?: string | null
}

interface SuggestionHabitLog {
  habit_id: string
  amount?: number | null
  duration?: number | null
  unit?: string | null
  date?: string | null
  completed_at?: string | null
  status?: string | null
}

const UNIT_ABBREVIATIONS: Record<string, string> = {
  Milligrams: 'mg',
  Minutes: 'min',
  Hours: 'hr',
  Miles: 'mi',
  Pages: 'pages',
  Steps: 'steps',
  Count: '',
  Kilometers: 'km',
  Grams: 'g',
  Kilograms: 'kg',
  Pounds: 'lbs',
  Calories: 'cal',
  Liters: 'L',
  Cups: 'cups',
  Glasses: 'glasses',
  Sets: 'sets',
  BPM: 'BPM',
}

const CHAT_TEMPLATES_GENERAL = [
  'What did I get done yesterday?',
  'What was I focused on this morning?',
  'How did my habits trend this week?',
  'What were my biggest wins this week?',
  'Where did my computer time go today?',
  'What should I improve based on my recent data?',
]

const CHAT_TEMPLATES_HABIT = [
  'How has my {habit} been this week?',
  'What is my trend for {habit} this month?',
  'How consistent have I been with {habit}?',
  'When do I usually log {habit}?',
  'How does {habit} compare to last week?',
]

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'be',
  'been',
  'compare',
  'did',
  'do',
  'for',
  'get',
  'has',
  'have',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'show',
  'tell',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'with',
])

const HABIT_ALIAS_RULES: Array<{ pattern: RegExp; aliases: string[] }> = [
  { pattern: /caffeine|coffee/i, aliases: ['consumed', 'drink', 'drank', 'coffee', 'caffeine', 'mg'] },
  { pattern: /nicotine|vape|smoke/i, aliases: ['consumed', 'vaped', 'smoked', 'nicotine', 'mg'] },
  { pattern: /water|hydration/i, aliases: ['drank', 'drink', 'water', 'hydration'] },
  { pattern: /sleep/i, aliases: ['slept', 'sleep', 'rest'] },
  { pattern: /read/i, aliases: ['read', 'reading', 'book', 'pages'] },
  { pattern: /walk/i, aliases: ['walk', 'walked', 'walking', 'steps', 'miles'] },
  { pattern: /run/i, aliases: ['run', 'ran', 'running', 'miles', 'km'] },
  { pattern: /coding|code/i, aliases: ['code', 'coding', 'programming', 'build', 'shipped'] },
  { pattern: /workout|exercise|gym/i, aliases: ['worked out', 'exercise', 'gym', 'training'] },
  { pattern: /screen time/i, aliases: ['screen', 'phone', 'device', 'screen time'] },
  { pattern: /computer time/i, aliases: ['computer', 'desktop', 'laptop', 'computer time'] },
]

const CONSUMPTION_VERBS = ['consume', 'consumed', 'drank', 'drink', 'ate', 'smoked', 'smoke', 'vaped', 'vape']
const DURATION_VERBS = ['worked', 'coded', 'coding', 'focused', 'slept', 'sleep', 'walked', 'walk', 'ran', 'run']
const GENERIC_LOG_TOKENS = new Set([
  ...CONSUMPTION_VERBS,
  ...DURATION_VERBS,
  'mg',
  'g',
  'kg',
  'lb',
  'lbs',
  'hr',
  'hrs',
  'hour',
  'hours',
  'min',
  'mins',
  'minute',
  'minutes',
  'steps',
  'step',
  'pages',
  'page',
  'cups',
  'cup',
  'liters',
  'liter',
  'glasses',
  'glass',
])

function hasTokenMatch(query: string, tokens: string[]): boolean {
  const normalized = normalizeText(query)
  return tokens.some((token) => normalized.includes(token))
}

function intentBoost(query: string, habit: SuggestionHabit, aliases: string[]): number {
  let score = 0
  const consumptionQuery = hasTokenMatch(query, CONSUMPTION_VERBS)
  const durationQuery = hasTokenMatch(query, DURATION_VERBS)
  const aliasText = aliases.join(' ')
  const unit = habit.unit_type || ''

  if (consumptionQuery) {
    if (aliasText.includes('consumed') || aliasText.includes('drink') || aliasText.includes('drank')) score += 45
    if (['Milligrams', 'Calories', 'Grams', 'Cups', 'Liters', 'Glasses'].includes(unit)) score += 28
    if (['Hours', 'Minutes', 'Steps', 'Pages'].includes(unit)) score -= 24
  }

  if (durationQuery) {
    if (['Hours', 'Minutes'].includes(unit)) score += 26
    if (['Milligrams', 'Calories'].includes(unit)) score -= 18
  }

  return score
}

function getFallbackHabitsForIntent(
  query: string,
  habits: SuggestionHabit[],
  stats: Map<string, { habit: SuggestionHabit; recentScore: number; commonValues: number[] }>
) {
  const consumptionQuery = hasTokenMatch(query, CONSUMPTION_VERBS)
  const durationQuery = hasTokenMatch(query, DURATION_VERBS)

  const filtered = habits.filter((habit) => {
    const unit = habit.unit_type || ''
    if (consumptionQuery) {
      return ['Milligrams', 'Calories', 'Grams', 'Cups', 'Liters', 'Glasses'].includes(unit)
    }
    if (durationQuery) {
      return ['Hours', 'Minutes'].includes(unit)
    }
    return false
  })

  return filtered
    .map((habit) => ({
      habit,
      stat: habit.id ? stats.get(habit.id) : undefined,
    }))
    .sort((a, b) => (b.stat?.recentScore || 0) - (a.stat?.recentScore || 0))
}

function extractAnchorTokens(query: string): string[] {
  return tokenize(query).filter((token) => {
    if (token.length < 3) return false
    if (STOP_WORDS.has(token) || GENERIC_LOG_TOKENS.has(token)) return false
    if (/^\d+$/.test(token)) return false
    if (/^\d+(mg|g|kg|lb|lbs|hr|hrs|min|mins)$/.test(token)) return false
    if (/^[a-z]?(mg|g|kg|lb|lbs|hr|hrs|min|mins)$/.test(token)) return false
    return true
  })
}

function matchesAnchorTokens(aliases: string[], habit: SuggestionHabit, anchorTokens: string[]): boolean {
  if (anchorTokens.length === 0) return true
  const haystack = normalizeText([habit.name, habit.category || '', ...aliases].join(' '))
  return anchorTokens.some((token) => haystack.includes(token))
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 0)
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function parseTimestamp(log: SuggestionHabitLog): number {
  const candidate = log.completed_at || log.date
  if (!candidate) return 0
  const parsed = Date.parse(candidate)
  return Number.isFinite(parsed) ? parsed : 0
}

function scoreCandidate(query: string, candidates: string[]): number {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return 0

  const queryTokens = tokenize(normalizedQuery).filter((token) => !STOP_WORDS.has(token))
  const fallbackTokens = queryTokens.length > 0 ? queryTokens : tokenize(normalizedQuery)
  let best = 0

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate)
    if (!normalizedCandidate) continue

    let score = 0
    if (normalizedCandidate === normalizedQuery) score += 240
    if (normalizedCandidate.startsWith(normalizedQuery)) score += 180
    else if (normalizedCandidate.includes(normalizedQuery)) score += 90

    const candidateTokens = tokenize(normalizedCandidate)
    let orderedMatches = 0
    let searchIndex = 0

    for (const token of fallbackTokens) {
      if (!token) continue
      const exact = candidateTokens.some((candidateToken) => candidateToken === token)
      const prefix = candidateTokens.some((candidateToken) => candidateToken.startsWith(token))
      const partial = normalizedCandidate.includes(token)

      if (exact) score += 30
      else if (prefix) score += 20
      else if (partial) score += 10

      const foundIndex = normalizedCandidate.indexOf(token, searchIndex)
      if (foundIndex >= 0) {
        orderedMatches += 1
        searchIndex = foundIndex + token.length
      }
    }

    score += orderedMatches * 12
    score -= Math.max(0, candidateTokens.length - fallbackTokens.length) * 2
    best = Math.max(best, score)
  }

  return best
}

function dedupeSuggestions(suggestions: ChatSuggestion[], limit: number): ChatSuggestion[] {
  const seen = new Set<string>()
  const result: ChatSuggestion[] = []

  for (const suggestion of suggestions) {
    const key = `${suggestion.type}:${normalizeText(suggestion.text)}`
    if (!suggestion.text.trim() || seen.has(key)) continue
    seen.add(key)
    result.push(suggestion)
    if (result.length >= limit) break
  }

  return result
}

function buildHabitAliases(habit: SuggestionHabit): string[] {
  const aliases = [habit.name, habit.category || '', habit.unit_type || '']

  for (const rule of HABIT_ALIAS_RULES) {
    if (rule.pattern.test(habit.name)) {
      aliases.push(...rule.aliases)
    }
  }

  return unique(
    aliases
      .map((value) => normalizeText(value))
      .filter(Boolean)
  )
}

function formatValueSuggestion(value: number, unitType: string | null | undefined, habitName: string): string {
  const abbrev = unitType ? UNIT_ABBREVIATIONS[unitType] ?? unitType : ''
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
  const habitLabel = habitName.toLowerCase()

  if (!abbrev) return `${rounded} ${habitLabel}`
  if (abbrev === 'min' || abbrev === 'hr') return `${rounded} ${abbrev} ${habitLabel}`

  if (['mg', 'g', 'kg', 'lbs', 'cal', 'L', 'km', 'mi'].includes(abbrev)) {
    return `${rounded}${abbrev} of ${habitLabel}`
  }

  return `${rounded} ${abbrev} of ${habitLabel}`
}

function valueFromLog(log: SuggestionHabitLog, unitType?: string | null): number | null {
  if (typeof log.amount === 'number' && log.amount > 0) {
    return log.amount
  }

  if (typeof log.duration === 'number' && log.duration > 0) {
    if (unitType === 'Hours') {
      return Math.round((log.duration / 3600) * 10) / 10
    }
    return Math.round(log.duration / 60)
  }

  return null
}

function buildHabitStats(
  habits: SuggestionHabit[],
  habitLogs: SuggestionHabitLog[]
): Map<string, { habit: SuggestionHabit; recentScore: number; commonValues: number[] }> {
  const completedLogs = habitLogs
    .filter((log) => !log.status || log.status === 'completed')
    .slice()
    .sort((a, b) => parseTimestamp(b) - parseTimestamp(a))

  const grouped = new Map<string, SuggestionHabitLog[]>()
  for (const log of completedLogs) {
    if (!log.habit_id) continue
    const entries = grouped.get(log.habit_id) || []
    entries.push(log)
    grouped.set(log.habit_id, entries)
  }

  const stats = new Map<string, { habit: SuggestionHabit; recentScore: number; commonValues: number[] }>()

  for (const habit of habits) {
    if (!habit.id) continue
    const logs = grouped.get(habit.id) || []
    const weights = new Map<number, number>()

    logs.forEach((log, index) => {
      const value = valueFromLog(log, habit.unit_type)
      if (value == null) return

      const roundedValue = Math.round(value * 10) / 10
      const current = weights.get(roundedValue) || 0
      weights.set(roundedValue, current + Math.max(1, 12 - index))
    })

    const commonValues = Array.from(weights.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => value)
      .slice(0, 4)

    const latestTimestamp = logs[0] ? parseTimestamp(logs[0]) : 0
    const ageHours = latestTimestamp > 0 ? (Date.now() - latestTimestamp) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY
    const recencyScore = latestTimestamp > 0 ? Math.max(0, 80 - Math.min(ageHours, 72)) : 0
    const frequencyBoost = Math.min(logs.length, 10) * 3

    stats.set(habit.id, {
      habit,
      recentScore: recencyScore + frequencyBoost,
      commonValues,
    })
  }

  return stats
}

function extractTypedValue(query: string): number | null {
  const match = query.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function buildLogSuggestions(
  query: string,
  habits: SuggestionHabit[],
  habitLogs: SuggestionHabitLog[],
  limit: number
): ChatSuggestion[] {
  const stats = buildHabitStats(habits, habitLogs)
  const typedValue = extractTypedValue(query)
  const normalizedQuery = normalizeText(query)
  const anchorTokens = extractAnchorTokens(normalizedQuery)
  const candidates: ChatSuggestion[] = []

  if (!normalizedQuery) {
    for (const stat of Array.from(stats.values()).sort((a, b) => b.recentScore - a.recentScore)) {
      if (stat.commonValues[0] != null) {
        candidates.push({
          text: formatValueSuggestion(stat.commonValues[0], stat.habit.unit_type, stat.habit.name),
          type: 'log_phrase',
          habit_id: stat.habit.id,
          habit_name: stat.habit.name,
          unit_type: stat.habit.unit_type || undefined,
          value: stat.commonValues[0],
          hint: 'Recent log',
          score: stat.recentScore,
          source: 'local',
        })
      } else {
        candidates.push({
          text: stat.habit.name,
          type: 'habit',
          habit_id: stat.habit.id,
          habit_name: stat.habit.name,
          unit_type: stat.habit.unit_type || undefined,
          hint: stat.habit.unit_type || 'Habit',
          score: stat.recentScore,
          source: 'local',
        })
      }
    }

    return dedupeSuggestions(candidates, limit)
  }

  const rankedHabits = habits
    .map((habit) => {
      const aliases = buildHabitAliases(habit)
      const anchorMatch = matchesAnchorTokens(aliases, habit, anchorTokens)
      const score =
        scoreCandidate(normalizedQuery, [habit.name, ...(habit.category ? [habit.category] : []), ...aliases]) +
        intentBoost(normalizedQuery, habit, aliases) +
        (anchorMatch && anchorTokens.length > 0 ? 120 : 0)
      const stat = habit.id ? stats.get(habit.id) : null
      return {
        habit,
        anchorMatch,
        score: score + (stat?.recentScore || 0),
        stat,
      }
    })
    .filter((candidate) => candidate.score > 30 && (anchorTokens.length === 0 || candidate.anchorMatch))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)

  for (const candidate of rankedHabits) {
    const topValues = candidate.stat?.commonValues || []
    const chosenValues = typedValue != null ? [typedValue, ...topValues] : topValues

    for (const value of unique(chosenValues).slice(0, typedValue != null ? 2 : 3)) {
      candidates.push({
        text: formatValueSuggestion(value, candidate.habit.unit_type, candidate.habit.name),
        type: 'log_phrase',
        habit_id: candidate.habit.id,
        habit_name: candidate.habit.name,
        unit_type: candidate.habit.unit_type || undefined,
        value,
        hint: `Log ${candidate.habit.name}`,
        score: candidate.score + 20,
        source: 'local',
      })
    }

    candidates.push({
      text: candidate.habit.name,
      type: 'habit',
      habit_id: candidate.habit.id,
      habit_name: candidate.habit.name,
      unit_type: candidate.habit.unit_type || undefined,
      hint: candidate.habit.unit_type || 'Habit',
      score: candidate.score,
      source: 'local',
    })
  }

  if (typedValue != null && candidates.length === 0) {
    let fallbackIntentHabits = getFallbackHabitsForIntent(normalizedQuery, habits, stats)
    if (anchorTokens.length > 0) {
      fallbackIntentHabits = fallbackIntentHabits.filter(({ habit }) =>
        matchesAnchorTokens(buildHabitAliases(habit), habit, anchorTokens)
      )
    }
    for (const item of fallbackIntentHabits.slice(0, 3)) {
      const stat = item.stat
      if (!stat?.habit.id) continue
      candidates.push({
        text: formatValueSuggestion(typedValue, stat.habit.unit_type, stat.habit.name),
        type: 'log_phrase',
        habit_id: stat.habit.id,
        habit_name: stat.habit.name,
        unit_type: stat.habit.unit_type || undefined,
        value: typedValue,
        hint: `Try ${stat.habit.name}`,
        score: stat.recentScore,
        source: 'local',
      })
    }
  }

  if (candidates.length === 0 && anchorTokens.length > 0) {
    const anchoredHabits = habits
      .filter((habit) => matchesAnchorTokens(buildHabitAliases(habit), habit, anchorTokens))
      .slice(0, 4)

    for (const habit of anchoredHabits) {
      const stat = habit.id ? stats.get(habit.id) : null
      const values = stat?.commonValues || []
      if (values[0] != null) {
        candidates.push({
          text: formatValueSuggestion(values[0], habit.unit_type, habit.name),
          type: 'log_phrase',
          habit_id: habit.id,
          habit_name: habit.name,
          unit_type: habit.unit_type || undefined,
          value: values[0],
          hint: `Log ${habit.name}`,
          score: 160,
          source: 'local',
        })
      } else {
        candidates.push({
          text: habit.name,
          type: 'habit',
          habit_id: habit.id,
          habit_name: habit.name,
          unit_type: habit.unit_type || undefined,
          hint: habit.unit_type || 'Habit',
          score: 140,
          source: 'local',
        })
      }
    }
  }

  return dedupeSuggestions(
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0)),
    limit
  )
}

function buildChatSuggestionPool(habits: SuggestionHabit[], habitLogs: SuggestionHabitLog[]): ChatSuggestion[] {
  const stats = buildHabitStats(habits, habitLogs)
  const recentHabits = Array.from(stats.values())
    .sort((a, b) => b.recentScore - a.recentScore)
    .map((entry) => entry.habit.name)
    .filter(Boolean)
    .slice(0, 6)

  const suggestions: ChatSuggestion[] = CHAT_TEMPLATES_GENERAL.map((text, index) => ({
    text,
    type: 'question',
    hint: index < 2 ? 'Popular question' : 'Ask in chat',
    score: 40 - index,
    source: 'local',
  }))

  for (const habitName of recentHabits) {
    for (const template of CHAT_TEMPLATES_HABIT) {
      suggestions.push({
        text: template.replace('{habit}', habitName.toLowerCase()),
        type: 'question',
        habit_name: habitName,
        hint: `About ${habitName}`,
        score: 60,
        source: 'local',
      })
    }
  }

  return suggestions
}

function buildChatSuggestions(
  query: string,
  habits: SuggestionHabit[],
  habitLogs: SuggestionHabitLog[],
  limit: number
): ChatSuggestion[] {
  const normalizedQuery = normalizeText(query)
  const pool = buildChatSuggestionPool(habits, habitLogs)

  if (!normalizedQuery) {
    return dedupeSuggestions(pool.sort((a, b) => (b.score || 0) - (a.score || 0)), limit)
  }

  const ranked = pool
    .map((suggestion) => ({
      ...suggestion,
      score:
        scoreCandidate(normalizedQuery, [
          suggestion.text,
          suggestion.habit_name || '',
          suggestion.hint || '',
        ]) + (suggestion.score || 0),
    }))
    .filter((suggestion) => (suggestion.score || 0) > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  if (ranked.length > 0) {
    return dedupeSuggestions(ranked, limit)
  }

  return dedupeSuggestions(
    [
      {
        text: `What patterns do you see around ${query.trim()}?`,
        type: 'question',
        hint: 'Ask in chat',
        score: 50,
        source: 'local',
      },
      {
        text: `How has ${query.trim()} changed over time?`,
        type: 'question',
        hint: 'Ask in chat',
        score: 45,
        source: 'local',
      },
      {
        text: `When was ${query.trim()} strongest for me?`,
        type: 'question',
        hint: 'Ask in chat',
        score: 40,
        source: 'local',
      },
    ],
    limit
  )
}

export function buildInstantSuggestions({
  mode,
  query,
  habits,
  habitLogs,
  limit = 4,
}: {
  mode: SuggestionMode
  query: string
  habits: SuggestionHabit[]
  habitLogs: SuggestionHabitLog[]
  limit?: number
}): ChatSuggestion[] {
  return mode === 'log'
    ? buildLogSuggestions(query, habits, habitLogs, limit)
    : buildChatSuggestions(query, habits, habitLogs, limit)
}

export function mergeSuggestions(
  localSuggestions: ChatSuggestion[],
  remoteSuggestions: ChatSuggestion[],
  limit = 4
): ChatSuggestion[] {
  const merged = [
    ...localSuggestions.map((suggestion) => ({ ...suggestion, source: 'local' as const })),
    ...remoteSuggestions.map((suggestion) => ({ ...suggestion, source: 'server' as const })),
  ].sort((a, b) => (b.score || 0) - (a.score || 0))

  return dedupeSuggestions(merged, limit)
}
