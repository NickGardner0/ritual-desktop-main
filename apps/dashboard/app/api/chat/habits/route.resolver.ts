import { getServerBackendBaseUrl } from '@/lib/api/server-client';

export const PYTHON_API_BASE = getServerBackendBaseUrl();

export interface LogIntent {
  habit_hint: string;
  value: number | null;
  unit: string | null;
  date: string;
  notes: string;
}

export interface ResolvedIntent extends LogIntent {
  habit_id: string | null;
  habit_name: string | null;
  match_type: string;
  confidence: number;
  needs_clarification: boolean;
  alternatives: Array<{ id: string; name: string; confidence: number }>;
  unit_compatible: boolean;
  unit_error?: string;
  converted_value?: number;
}

export interface LogResult {
  index: number;
  success: boolean;
  habit_id?: string;
  habit_name?: string;
  value?: number;
  unit?: string;
  date?: string;
  error?: string;
  needs_clarification?: boolean;
  alternatives?: Array<{ id: string; name: string; confidence: number }>;
}

// Phase 5A: Unit conversion utilities (server-side)
const UNIT_CANONICAL: Record<string, string> = {
  min: 'minutes', mins: 'minutes', minute: 'minutes',
  hr: 'hours', hrs: 'hours', hour: 'hours',
  mi: 'miles', mile: 'miles',
  km: 'kilometers', kilometer: 'kilometers',
  step: 'steps', pg: 'pages', page: 'pages',
};

export function normalizeUnit(unit: string | null): string {
  if (!unit) return 'count';
  const lower = unit.toLowerCase().trim();
  return UNIT_CANONICAL[lower] || lower;
}

export function convertValue(value: number, fromUnit: string, toUnit: string): { value: number; converted: boolean } {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  
  if (from === to) return { value, converted: false };
  
  // Time conversions
  if (from === 'minutes' && to === 'hours') return { value: value / 60, converted: true };
  if (from === 'hours' && to === 'minutes') return { value: value * 60, converted: true };
  
  // Distance conversions
  if (from === 'kilometers' && to === 'miles') return { value: value * 0.621371, converted: true };
  if (from === 'miles' && to === 'kilometers') return { value: value * 1.60934, converted: true };
  
  return { value, converted: false };
}

export function checkUnitCompatibility(intentUnit: string | null, habitUnit: string | null): { compatible: boolean; error?: string } {
  const from = normalizeUnit(intentUnit);
  const to = normalizeUnit(habitUnit);
  
  if (from === to || to === 'count' || from === 'count') return { compatible: true };
  
  const timeUnits = ['minutes', 'hours', 'seconds'];
  if (timeUnits.includes(from) && timeUnits.includes(to)) return { compatible: true };
  
  const distanceUnits = ['miles', 'kilometers', 'meters'];
  if (distanceUnits.includes(from) && distanceUnits.includes(to)) return { compatible: true };
  
  return { compatible: false, error: `Cannot convert ${intentUnit} to ${habitUnit}` };
}

// Helper: Get common prefix length between two strings
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

const STEP_RELATED_HINTS = new Set([
  'step',
  'steps',
  'walk',
  'walked',
  'walking',
  'walks',
  'hike',
  'hiked',
  'hiking',
  'run',
  'ran',
  'running',
  'jog',
  'jogged',
  'jogging',
]);

const GENERIC_MATCH_WORDS = new Set([
  'consumption',
  'intake',
  'time',
  'duration',
  'daily',
]);

const CAFFEINE_CONTEXT_TERMS = [
  'caffeine',
  'coffee',
  'espresso',
  'latte',
  'americano',
  'matcha',
  'energy drink',
  'pre workout',
  'pre-workout',
  'tea',
];

const NICOTINE_CONTEXT_TERMS = [
  'nicotine',
  'vape',
  'vaped',
  'vaping',
  'smoke',
  'smoked',
  'smoking',
  'cigarette',
  'cigarettes',
  'cigar',
  'zyn',
  'pouch',
  'pouches',
  'dip',
  'tobacco',
];

function tokenizeLowerText(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

function textHasAnyTerm(rawText: string, tokens: Set<string>, terms: string[]): boolean {
  return terms.some((term) => {
    const lower = term.toLowerCase();
    if (lower.includes(' ')) {
      return rawText.includes(lower);
    }
    return tokens.has(lower);
  });
}

// Phase 5A: Simple fuzzy resolver (server-side implementation)
export function resolveHabit(
  hint: string,
  userHabits: Array<{ id: string; name: string; category: string; unit_type: string }>,
  aliasesMap: Record<string, string[]>,
  intentUnit: string | null = null,
  originalText: string = ''
): {
  habit_id: string | null;
  habit_name: string | null;
  match_type: string;
  confidence: number;
  alternatives: Array<{ id: string; name: string; confidence: number }>;
  needs_clarification: boolean;
} {
  const hintLower = hint.toLowerCase().trim();
  const normalizedIntentUnit = normalizeUnit(intentUnit);
  const contextLower = `${hintLower} ${originalText.toLowerCase().trim()}`.trim();
  const contextTokens = tokenizeLowerText(contextLower);
  const hasCaffeineContext = textHasAnyTerm(contextLower, contextTokens, CAFFEINE_CONTEXT_TERMS);
  const hasNicotineContext = textHasAnyTerm(contextLower, contextTokens, NICOTINE_CONTEXT_TERMS);
  const candidateMap = new Map<string, { habit: typeof userHabits[0]; type: string; confidence: number }>();

  const pushCandidate = (
    habit: typeof userHabits[0],
    type: string,
    confidence: number
  ) => {
    const existing = candidateMap.get(habit.id);
    if (!existing || confidence > existing.confidence) {
      candidateMap.set(habit.id, { habit, type, confidence });
    }
  };
  
  for (const habit of userHabits) {
    const nameLower = habit.name.toLowerCase();
    const aliases = aliasesMap[habit.id] || [];
    const habitUnit = normalizeUnit(habit.unit_type);
    const habitDescriptor = `${nameLower} ${aliases.join(' ')}`;
    const habitDescriptorTokens = tokenizeLowerText(habitDescriptor);
    const isCaffeineHabit = textHasAnyTerm(habitDescriptor, habitDescriptorTokens, CAFFEINE_CONTEXT_TERMS);
    const isNicotineHabit = textHasAnyTerm(habitDescriptor, habitDescriptorTokens, NICOTINE_CONTEXT_TERMS);

    if (hasCaffeineContext && isCaffeineHabit) {
      pushCandidate(habit, 'semantic', 0.995);
    }

    if (hasNicotineContext && isNicotineHabit) {
      pushCandidate(habit, 'semantic', 0.995);
    }
    
    // 1. Exact match
    if (hintLower === nameLower) {
      pushCandidate(habit, 'exact', 1.0);
      continue;
    }
    
    // 2. Alias match
    for (const alias of aliases) {
      if (hintLower === alias) {
        pushCandidate(habit, 'alias', 0.95);
        break;
      }
      if (hintLower.includes(alias) || alias.includes(hintLower)) {
        pushCandidate(habit, 'alias', 0.8);
        break;
      }
    }
    
    // 3. Substring match
    if (nameLower.includes(hintLower)) {
      pushCandidate(habit, 'substring', 0.85 * hintLower.length / nameLower.length);
      continue;
    }
    if (hintLower.includes(nameLower)) {
      pushCandidate(habit, 'substring', 0.75);
      continue;
    }
    
    // 4. Stem/prefix match (handles "meditate" → "meditation", "code" → "coding", etc.)
    const prefixLen = commonPrefixLength(hintLower, nameLower);
    const minLen = Math.min(hintLower.length, nameLower.length);
    if (prefixLen >= 4 && prefixLen >= minLen * 0.7) {
      // Strong prefix match - likely same root word
      const confidence = 0.9 * (prefixLen / Math.max(hintLower.length, nameLower.length));
      pushCandidate(habit, 'stem', Math.max(confidence, 0.85));
      continue;
    }
    
    // 5. Word match (check all words for best match)
    const nameWords = nameLower.split(/\s+/).filter((word) => !GENERIC_MATCH_WORDS.has(word));
    let bestWordMatch: { type: string; confidence: number } | null = null;
    
    for (const word of nameWords) {
      // Exact word match
      if (hintLower === word) {
        bestWordMatch = { type: 'token', confidence: 0.95 };
        break;
      }
      
      // Stem/prefix match on word (e.g., "read" → "reading")
      const wordPrefixLen = commonPrefixLength(hintLower, word);
      const minLen = Math.min(hintLower.length, word.length);
      if (wordPrefixLen >= 3 && wordPrefixLen >= minLen * 0.7) {
        const conf = 0.85 + (0.1 * wordPrefixLen / Math.max(hintLower.length, word.length));
        if (!bestWordMatch || conf > bestWordMatch.confidence) {
          bestWordMatch = { type: 'stem', confidence: Math.min(conf, 0.95) };
        }
      }
      
      // Substring containment (lower confidence)
      if (word.length >= 3 && (hintLower.includes(word) || word.includes(hintLower))) {
        const conf = 0.8 * Math.min(hintLower.length, word.length) / Math.max(hintLower.length, word.length);
        if (!bestWordMatch || conf > bestWordMatch.confidence) {
          bestWordMatch = { type: 'token', confidence: Math.max(conf, 0.75) };
        }
      }
    }
    
    if (bestWordMatch) {
      pushCandidate(habit, bestWordMatch.type, bestWordMatch.confidence);
    }

    if (normalizedIntentUnit !== 'count' && habitUnit === normalizedIntentUnit) {
      const existing = candidateMap.get(habit.id);
      if (existing) {
        pushCandidate(habit, `${existing.type}+unit`, Math.min(existing.confidence + 0.18, 0.99));
      } else {
        pushCandidate(habit, 'unit', 0.55);
      }
    }

    if (
      normalizedIntentUnit === 'steps' &&
      habitUnit === 'steps' &&
      STEP_RELATED_HINTS.has(hintLower)
    ) {
      pushCandidate(habit, 'unit_semantic', 0.98);
    }
  }

  const candidates = Array.from(candidateMap.values());
  
  // Sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);
  
  if (candidates.length === 0) {
    return {
      habit_id: null,
      habit_name: null,
      match_type: 'none',
      confidence: 0,
      alternatives: [],
      needs_clarification: true
    };
  }
  
  const best = candidates[0];
  const alternatives = candidates.slice(1, 4).map(c => ({
    id: c.habit.id,
    name: c.habit.name,
    confidence: Math.round(c.confidence * 100) / 100
  }));
  
  // Simplified clarification logic - be VERY permissive
  // Only ask for clarification if:
  // 1. No match at all (confidence = 0), OR
  // 2. Multiple matches with VERY similar confidence (within 5%) AND low overall confidence
  const bestTypeIsLowSignal =
    best.type.includes('unit') ||
    best.type === 'token' ||
    best.type === 'stem';
  const hasCompetingMatch = alternatives.length > 0 &&
    alternatives[0].confidence > best.confidence - 0.03 &&
    (best.confidence < 0.75 || bestTypeIsLowSignal);
  
  const needsClarification = best.confidence === 0 || hasCompetingMatch;
  
  return {
    habit_id: needsClarification ? null : best.habit.id,
    habit_name: best.habit.name,
    match_type: best.type,
    confidence: Math.round(best.confidence * 100) / 100,
    alternatives: needsClarification 
      ? [{ id: best.habit.id, name: best.habit.name, confidence: Math.round(best.confidence * 100) / 100 }, ...alternatives]
      : alternatives,
    needs_clarification: needsClarification
  };
}
