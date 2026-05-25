import type { ChatSuggestion } from '@/lib/ai/chat-suggestions';
import type { InputMode, ParsedHabitInput } from './ai-habit-chat.types';

type HabitLike = {
  id?: string | null;
  name: string;
  unit_type?: string | null;
};

type MatchedHabit = {
  id: string;
  name: string;
  unit_type: string;
};

const GENERIC_MATCH_WORDS = new Set(['consumption', 'intake', 'time', 'duration', 'daily']);

export function wordsToDigits(text: string): string {
  const ones: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  };
  const tens: Record<string, number> = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fourty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };

  let out = text;
  out = out.replace(
    /\b(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (_, a: string, b: string) => String(tens[a.toLowerCase()] + ones[b.toLowerCase()]),
  );
  out = out.replace(
    /\b(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)\b/gi,
    (match) => String(tens[match.toLowerCase()]),
  );
  out = out.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi,
    (match) => String(ones[match.toLowerCase()]),
  );
  out = out.replace(/\b(a|one)\s+hundred\b/gi, '100');
  out = out.replace(/\bhalf\b/gi, '0.5');
  out = out.replace(/\b(a\s+)?quarter\b/gi, '0.25');
  out = out.replace(
    /\b(a|an)\s+(mile|miles|page|pages|hour|hours|minute|minutes|step|steps|kilometer|kilometers|km|rep|reps)\b/gi,
    '1 $2',
  );
  return out;
}

export function normalizeLoggerVoiceTranscript(text: string): string {
  return text.trim().replace(/[.?!]\s*$/, '');
}

export function parseLocalHabitInput(rawText: string, habits: HabitLike[]): ParsedHabitInput | null {
  const text = wordsToDigits(rawText);
  const lowerText = text.toLowerCase();
  const timePatterns = [
    { regex: /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr)/i, unit: 'Hours', isDuration: true },
    { regex: /(\d+)\s*(minutes?|mins?|min)/i, unit: 'Minutes', isDuration: true },
    { regex: /(\d+(?:\.\d+)?)\s*(miles?|mile)/i, unit: 'Miles', isDuration: false },
    { regex: /(\d+)\s*(pages?|page)/i, unit: 'Pages', isDuration: false },
    { regex: /(\d+(?:\.\d+)?)\s*(kilometers?|kms?|km)/i, unit: 'Kilometers', isDuration: false },
    { regex: /(\d+)\s*(steps?|step)/i, unit: 'Steps', isDuration: false },
    { regex: /(\d+(?:\.\d+)?)\s*(milligrams?|mgs?|mg)/i, unit: 'Milligrams', isDuration: false },
    { regex: /(\d+(?:\.\d+)?)\s*(grams?|gms?|g)\b/i, unit: 'Grams', isDuration: false },
    { regex: /(\d+(?:\.\d+)?)\s*(kilograms?|kgs?|kg)/i, unit: 'Kilograms', isDuration: false },
    { regex: /(\d+(?:\.\d+)?)\s*(pounds?|lbs?|lb)/i, unit: 'Pounds', isDuration: false },
    { regex: /(\d+)\s*(calories?|cals?|cal)/i, unit: 'Calories', isDuration: false },
    { regex: /(\d+(?:\.\d+)?)\s*(liters?|litres?|l)\b/i, unit: 'Liters', isDuration: false },
    { regex: /(\d+)\s*(cups?|cup)/i, unit: 'Cups', isDuration: false },
    { regex: /(\d+)\s*(glasses?|glass)/i, unit: 'Glasses', isDuration: false },
    { regex: /(\d+)\s*(pull-?ups?|pullups?)/i, unit: 'Count', isDuration: false },
    { regex: /(\d+)\s*(push-?ups?|pushups?)/i, unit: 'Count', isDuration: false },
    { regex: /(\d+)\s*(sit-?ups?|situps?)/i, unit: 'Count', isDuration: false },
    { regex: /(\d+)\s*(squats?)/i, unit: 'Count', isDuration: false },
    { regex: /(\d+)\s*(reps?|repetitions?)/i, unit: 'Count', isDuration: false },
    { regex: /(\d+)\s*(sets?)/i, unit: 'Sets', isDuration: false },
  ];

  const findMatchingHabit = (searchText: string, detectedUnit?: string) => {
    const searchTerms = searchText.toLowerCase();
    const detectedUnitLower = detectedUnit?.toLowerCase();
    const hasWalkIntent = /\b(walk|walked|walking|hiked|hike)\b/i.test(searchTerms);
    const hasRunIntent = /\b(run|ran|running|jog|jogged|jogging)\b/i.test(searchTerms);
    const hasDriveIntent = /\b(car|drive|drove|driving|tesla|odometer)\b/i.test(searchTerms);
    const candidateHabits = [...habits].sort((a, b) => {
      const aUnitMatch = (a.unit_type || '').toLowerCase() === detectedUnitLower;
      const bUnitMatch = (b.unit_type || '').toLowerCase() === detectedUnitLower;
      return Number(bUnitMatch) - Number(aUnitMatch);
    });

    if (['miles', 'mile', 'kilometers', 'kilometer'].includes(detectedUnitLower || '')) {
      const movementMatch = candidateHabits.find((habit) => {
        const habitName = habit.name.toLowerCase();
        if (hasWalkIntent) return habitName.includes('walk') || habitName.includes('hike');
        if (hasRunIntent) return habitName.includes('run') || habitName.includes('jog');
        if (hasDriveIntent) return habitName.includes('car') || habitName.includes('drive') || habitName.includes('tesla');
        return false;
      });
      if (movementMatch) return movementMatch;
    }

    if (detectedUnitLower === 'milligrams') {
      if (/(nicotine|vape|vaped|vaping|smoke|smoked|smoking|cigarette|cigarettes|zyn|pouch|pouches|dip|tobacco)/i.test(searchTerms)) {
        const nicotine = candidateHabits.find((habit) => habit.name.toLowerCase().includes('nicotine'));
        if (nicotine) return nicotine;
      }
      if (/(caffeine|coffee|espresso|latte|americano|matcha|energy drink|pre-workout|pre workout|tea)/i.test(searchTerms)) {
        const caffeine = candidateHabits.find((habit) => habit.name.toLowerCase().includes('caffeine'));
        if (caffeine) return caffeine;
      }
    }

    for (const habit of candidateHabits) {
      const habitName = habit.name.toLowerCase();
      const significantWords = habitName
        .split(' ')
        .filter((word) => word.length > 2)
        .filter((word) => !GENERIC_MATCH_WORDS.has(word))
        .filter((word) => !['mile', 'miles', 'kilometer', 'kilometers', 'km', 'steps', 'step', 'hours', 'hour', 'minutes', 'minute', 'pages', 'page'].includes(word));
      const matches = [
        { terms: ['read', 'reading'], habitWord: 'reading' },
        { terms: ['walk', 'walked', 'walking'], habitWord: 'walk' },
        { terms: ['meditat', 'meditation'], habitWord: 'meditat' },
        { terms: ['workout', 'exercise', 'gym', 'worked out'], habitWord: 'workout' },
        { terms: ['deep work', 'work session', 'focus'], habitWord: 'work' },
        { terms: ['skill', 'learning', 'study', 'technical'], habitWord: 'skill' },
        { terms: ['caffeine', 'coffee'], habitWord: 'caffeine' },
        { terms: ['nicotine', 'vape', 'vaped', 'smoke', 'smoked', 'zyn', 'tobacco'], habitWord: 'nicotine' },
        { terms: ['water', 'hydrat', 'drank'], habitWord: 'water' },
        { terms: ['sleep', 'slept'], habitWord: 'sleep' },
        { terms: ['code', 'coding', 'programm'], habitWord: 'cod' },
        { terms: ['pull-up', 'pullup', 'pull up'], habitWord: 'pull' },
        { terms: ['push-up', 'pushup', 'push up'], habitWord: 'push' },
        { terms: ['squat'], habitWord: 'squat' },
        { terms: ['run', 'running', 'ran'], habitWord: 'run' },
      ];

      if (matches.some((match) => match.terms.some((term) => searchTerms.includes(term)) && habitName.includes(match.habitWord))) {
        return habit;
      }
      if (significantWords.some((word) => searchTerms.includes(word))) return habit;
      if (searchTerms.includes(habitName)) return habit;
    }
    return null;
  };

  for (const pattern of timePatterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    const value = parseFloat(match[1]);
    const matchingHabit = findMatchingHabit(text, pattern.unit);
    if (!matchingHabit) continue;

    return {
      habitName: matchingHabit.name,
      amount: pattern.isDuration ? null : value,
      duration: pattern.isDuration ? (pattern.unit === 'Hours' ? value * 60 : value) : null,
      unit: pattern.unit,
      activity: text,
      success: true,
    };
  }

  if (lowerText.length === 0) return null;
  return null;
}

export function getHabitByParsedName(habits: HabitLike[], habitName?: string | null): MatchedHabit | null {
  if (!habitName) return null;
  const matched = habits.find((habit) => habit.name.toLowerCase() === habitName.toLowerCase());
  if (!matched?.id) return null;
  return {
    id: matched.id,
    name: matched.name,
    unit_type: matched.unit_type || '',
  };
}

export function getParsedDisplayValue(
  parsed: ParsedHabitInput,
  habitUnit?: string | null,
): { value: number; unitLabel: string } {
  if (parsed.amount != null) {
    return {
      value: parsed.amount,
      unitLabel: parsed.unit || habitUnit || 'Count',
    };
  }

  const normalizedHabitUnit = (habitUnit || parsed.unit || '').toLowerCase();
  if (parsed.duration != null) {
    if (normalizedHabitUnit === 'hours') {
      return {
        value: Math.round((parsed.duration / 60) * 10) / 10,
        unitLabel: 'Hours',
      };
    }

    return {
      value: Math.round(parsed.duration * 10) / 10,
      unitLabel: parsed.unit || habitUnit || 'Minutes',
    };
  }

  return {
    value: 1,
    unitLabel: parsed.unit || habitUnit || 'Count',
  };
}

export function formatParsedValueLabel(value: number, unitLabel: string): string {
  if (unitLabel === 'Hours') return `${value} ${value === 1 ? 'hour' : 'hours'}`;
  if (unitLabel === 'Minutes') return `${value} min`;
  if (unitLabel === 'Pages') return `${value} ${value === 1 ? 'page' : 'pages'}`;
  if (unitLabel === 'Steps') return `${value} ${value === 1 ? 'step' : 'steps'}`;
  if (unitLabel === 'Miles') return `${value} ${value === 1 ? 'mile' : 'miles'}`;
  if (unitLabel === 'Milligrams') return `${value}mg`;
  if (unitLabel === 'Count') return `${value}`;
  return `${value} ${unitLabel.toLowerCase()}`;
}

export function buildDeterministicLogSuggestion(
  query: string,
  mode: InputMode,
  habits: HabitLike[],
): ChatSuggestion | null {
  if (mode !== 'log' || !query.trim()) return null;
  const parsed = parseLocalHabitInput(query, habits);
  if (!parsed?.success) return null;

  const matchedHabit = getHabitByParsedName(habits, parsed.habitName);
  if (!matchedHabit) return null;

  const { value, unitLabel } = getParsedDisplayValue(parsed, matchedHabit.unit_type);
  return {
    text: `${matchedHabit.name} — ${formatParsedValueLabel(value, unitLabel)}`,
    type: 'log_phrase',
    habit_id: matchedHabit.id,
    habit_name: matchedHabit.name,
    unit_type: matchedHabit.unit_type || undefined,
    value,
    hint: `Log ${matchedHabit.name}`,
    score: 1000,
    source: 'local',
  };
}
