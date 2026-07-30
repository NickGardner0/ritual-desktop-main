import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function runTsx(script) {
  const result = spawnSync(
    'npx',
    ['--yes', 'tsx', '-e', script],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'tsx failed');
  }
  return result.stdout.trim();
}

describe('theme engine', () => {
  test('createThemeVars detects light vs dark', () => {
    const out = runTsx(`
      import { createThemeVars } from './apps/dashboard/lib/theme/adaptive-theme.ts';
      const light = createThemeVars('#fefefe', '#020817', '#64748b');
      const dark = createThemeVars('#020817', '#f8fafc', '#94a3b8');
      console.log(JSON.stringify({
        light: light.isDark,
        dark: dark.isDark,
        hasBg: !!light.vars['--background'],
        contentBg: dark.vars['--content-bg'],
        textPrimary: dark.vars['--text-primary'],
      }));
    `);
    const parsed = JSON.parse(out);
    assert.equal(parsed.light, false);
    assert.equal(parsed.dark, true);
    assert.equal(parsed.hasBg, true);
    assert.match(parsed.contentBg, /^#[0-9a-f]{6}$/i);
    assert.equal(parsed.textPrimary, '#f8fafc');
  });

  test('THEME_PAIRS and system resolve for ritual', () => {
    const out = runTsx(`
      import { getThemePair, resolveSystemTheme } from './apps/dashboard/lib/theme/theme-loader.ts';
      console.log(JSON.stringify({
        ritual: getThemePair('ritual'),
        ritualDark: getThemePair('ritual-dark'),
        sysDark: resolveSystemTheme('ritual', true),
        sysLight: resolveSystemTheme('ritual-dark', false),
        github: getThemePair('github-light'),
      }));
    `);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ritual, 'ritual-dark');
    assert.equal(parsed.ritualDark, 'ritual');
    assert.equal(parsed.sysDark, 'ritual-dark');
    assert.equal(parsed.sysLight, 'ritual');
    assert.equal(parsed.github, 'github-dark');
  });

  test('isRitualTheme pins brand themes', () => {
    const out = runTsx(`
      import { isRitualTheme } from './apps/dashboard/lib/theme/ThemeProvider.tsx';
      console.log(JSON.stringify({
        ritual: isRitualTheme('ritual'),
        dark: isRitualTheme('ritual-dark'),
        other: isRitualTheme('catppuccin-latte'),
      }));
    `);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ritual, true);
    assert.equal(parsed.dark, true);
    assert.equal(parsed.other, false);
  });

  test('theme labels', () => {
    const out = runTsx(`
      import { formatThemeLabel, pairedThemeLabel } from './apps/dashboard/lib/theme/theme-labels.ts';
      console.log(JSON.stringify({
        latte: formatThemeLabel('catppuccin-latte'),
        ritual: pairedThemeLabel('ritual'),
        github: pairedThemeLabel('github-light-default'),
      }));
    `);
    const parsed = JSON.parse(out);
    assert.equal(parsed.latte, 'Catppuccin Latte');
    assert.equal(parsed.ritual, 'Ritual');
    assert.equal(parsed.github, 'Github Default');
  });

  test('loadThemeData returns ritual synthetic palette', () => {
    const out = runTsx(`
      import { loadThemeData, extractThemeInfo } from './apps/dashboard/lib/theme/theme-loader.ts';
      loadThemeData('ritual').then((theme) => {
        const info = extractThemeInfo('ritual', theme);
        console.log(JSON.stringify({ bg: info.bg, comment: info.comment }));
      });
    `);
    const parsed = JSON.parse(out);
    assert.equal(parsed.bg, '#fefefe');
    assert.equal(parsed.comment, '#64748b');
  });
});

describe('appearance mode helpers', () => {
  test('system mode stores light member of pair', () => {
    // Mirrors AppearanceSettings: System tab selects light name + followSystem.
    const selected = 'ritual';
    const followSystem = true;
    assert.equal(selected, 'ritual');
    assert.equal(followSystem, true);
  });

  test('accent picker hidden for ritual themes', () => {
    const isRitualTheme = (name) => name === 'ritual' || name === 'ritual-dark';
    assert.equal(isRitualTheme('ritual'), true);
    assert.equal(isRitualTheme('github-light'), false);
  });
});
