const MUI_PREFIX = 'mui:';
const LUCIDE_PREFIX = 'lucide:';
const MATERIAL_VARIANT_SUFFIX = /(Outlined|Rounded|Sharp|TwoTone)$/;
const PASCAL_TOKEN_PATTERN = /[A-Z][a-z0-9]*|[0-9]+/g;

const NUMBER_WORD_VALUES: Record<string, number> = {
  Zero: 0,
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
  Ten: 10,
  Eleven: 11,
  Twelve: 12,
  Thirteen: 13,
  Fourteen: 14,
  Fifteen: 15,
  Sixteen: 16,
  Seventeen: 17,
  Eighteen: 18,
  Nineteen: 19,
  Twenty: 20,
  Thirty: 30,
  Forty: 40,
  Fifty: 50,
  Sixty: 60,
  Seventy: 70,
  Eighty: 80,
  Ninety: 90,
  // Known typos in @mui/icons-material exports.
  Eightteen: 18,
  Fivteen: 15,
};

const NUMERIC_MATERIAL_SUFFIXES = new Set([
  'Mp',
  'K',
  'KPlus',
  'Kk',
  'Fps',
  'FpsSelect',
  'G',
  'GMobiledata',
  'GPlusMobiledata',
  'UpRating',
  'P',
  'DRotation',
]);

const MATERIAL_UNSUPPORTED_COMPONENT_NAMES = new Set([
  'Apple',
  'BlockFlipped',
  'CatchingPokemon',
  'Co2',
  'Crop169',
  'Crop32',
  'Crop54',
  'Crop75',
  'Discount',
  'Facebook',
  'FireHydrantAlt',
  'Fitbit',
  'GitHub',
  'Google',
  'Grid3x3',
  'Grid4x4',
  'InfoOutline',
  'Instagram',
  'LinkedIn',
  'Microsoft',
  'MiscellaneousServices',
  'NoCell',
  'NoMealsOuline',
  'OneKk',
  'PanoramaHorizontalSelect',
  'PanoramaPhotosphereSelect',
  'PanoramaVerticalSelect',
  'PanoramaWideAngleSelect',
  'PersonAddAlt1',
  'PersonRemoveAlt1',
  'Pinterest',
  'Pix',
  'PlayCircleFilled',
  'PlayCircleFilledWhite',
  'PlayCircleOutline',
  'Reddit',
  'SignalCellularConnectedNoInternet1Bar',
  'SignalCellularConnectedNoInternet2Bar',
  'SignalCellularConnectedNoInternet3Bar',
  'SignalWifi1Bar',
  'SignalWifi1BarLock',
  'SignalWifi2Bar',
  'SignalWifi2BarLock',
  'SignalWifi3Bar',
  'SignalWifi3BarLock',
  'SignalWifiStatusbarConnectedNoInternet4',
  'StarBorderPurple500',
  'StarPurple500',
  'Telegram',
  'ThreeSixty',
  'TimesOneMobiledata',
  'Twitter',
  'WbTwighlight',
  'WhatsApp',
  'WorkspacesFilled',
  'YouTube',
]);

export type ParsedIcon =
  | { provider: 'mui'; name: string }
  | { provider: 'lucide'; name: string }
  | { provider: 'emoji'; name: string };

export const stripMaterialVariant = (name: string): string =>
  name.replace(MATERIAL_VARIANT_SUFFIX, '');

const stripProviderPrefixes = (name: string): string =>
  name.replace(/^mui:/, '').replace(/^lucide:/, '');

const splitPascalTokens = (value: string): string[] =>
  value.match(PASCAL_TOKEN_PATTERN) ?? [];

const wordsToNumber = (words: string[]): number | null => {
  if (!words.length) return null;

  let total = 0;
  for (const word of words) {
    const value = NUMBER_WORD_VALUES[word];
    if (value === undefined) return null;
    total += value;
  }

  return total;
};

const toSnakeFromPascalTokens = (tokens: string[]): string =>
  tokens
    .map((token) =>
      token
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2'),
    )
    .join('_')
    .toLowerCase();

export const isUnsupportedMaterialComponentName = (raw: string): boolean => {
  const componentName = stripProviderPrefixes(stripMaterialVariant(raw));
  return MATERIAL_UNSUPPORTED_COMPONENT_NAMES.has(componentName);
};

export const isEmojiIcon = (value: string): boolean =>
  /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
    value,
  );

export const pascalToWords = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

export const normalizeIconSearch = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const flattenIconSearch = (value: string): string =>
  normalizeIconSearch(value).replace(/\s+/g, '');

export const kebabToPascal = (value: string): string =>
  value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

export const toLucideKebab = (value: string): string =>
  value
    .replace(/^lucide:/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .replace(/([0-9])([a-zA-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();

export const parseStoredIcon = (raw: string): ParsedIcon | null => {
  if (!raw) return null;

  if (isEmojiIcon(raw)) {
    return { provider: 'emoji', name: raw };
  }

  if (raw.startsWith(MUI_PREFIX)) {
    return { provider: 'mui', name: stripMaterialVariant(raw.slice(MUI_PREFIX.length)) };
  }

  if (raw.startsWith(LUCIDE_PREFIX)) {
    const name = raw.slice(LUCIDE_PREFIX.length);
    return { provider: 'lucide', name: name.includes('-') ? kebabToPascal(name) : name };
  }

  // Backward-compatible material naming format (e.g. DashboardSharp)
  if (MATERIAL_VARIANT_SUFFIX.test(raw)) {
    return { provider: 'mui', name: stripMaterialVariant(raw) };
  }

  // Backward-compatible lucide naming format
  if (raw.includes('-')) {
    return { provider: 'lucide', name: kebabToPascal(raw) };
  }

  return { provider: 'lucide', name: raw };
};

export const toMaterialSymbolLigature = (raw: string): string =>
{
  const cleaned = stripProviderPrefixes(stripMaterialVariant(raw));
  if (!cleaned) return 'dashboard';
  if (isUnsupportedMaterialComponentName(cleaned)) return 'dashboard';

  const tokens = splitPascalTokens(cleaned);
  let numericPrefixLength = 0;
  while (
    numericPrefixLength < tokens.length &&
    NUMBER_WORD_VALUES[tokens[numericPrefixLength]] !== undefined
  ) {
    numericPrefixLength += 1;
  }

  if (numericPrefixLength > 0) {
    const suffixKey = tokens.slice(numericPrefixLength).join('');
    if (NUMERIC_MATERIAL_SUFFIXES.has(suffixKey)) {
      const numericPrefix = wordsToNumber(tokens.slice(0, numericPrefixLength));
      if (numericPrefix !== null) {
        const suffix = toSnakeFromPascalTokens(tokens.slice(numericPrefixLength));
        if (suffix.startsWith('up_')) {
          return `${numericPrefix}_${suffix}`;
        }
        return `${numericPrefix}${suffix}`;
      }
    }
  }

  const ligature = cleaned
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/([a-zA-Z])([0-9])/g, '$1_$2')
    .replace(/([0-9])([a-zA-Z])/g, '$1_$2')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  return ligature || 'dashboard';
};
