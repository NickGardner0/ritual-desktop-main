"use client";

/**
 * Buzz-style Appearance picker: System/Light/Dark + theme grid + accent swatches.
 *
 * Adapted from Block Buzz (Apache-2.0):
 * https://github.com/block/buzz — desktop/src/features/settings/ui/SettingsPanels.tsx
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACCENT_COLORS,
  LIGHT_THEMES,
  RITUAL_GRADIENT_STOPS,
  SYNTAX_THEMES,
  SystemPreferencePreviewFrame,
  ThemePreviewFrame,
  type SyntaxThemeName,
  type ThemePreviewVars,
  formatThemeLabel,
  getThemeFallbackPreviewVars,
  getThemePair,
  isRitualTheme,
  pairedThemeLabel,
  useRitualTheme,
  useThemePreviewVars,
  withAccentPreviewVars,
} from "@/lib/theme";

function useThemeCategories() {
  return useMemo(() => {
    const pairedLight: SyntaxThemeName[] = [];
    const lightOnly: SyntaxThemeName[] = [];
    const darkOnly: SyntaxThemeName[] = [];

    const darkPairMembers = new Set<string>();
    for (const name of SYNTAX_THEMES) {
      if (LIGHT_THEMES.has(name)) {
        const pair = getThemePair(name);
        if (pair) {
          darkPairMembers.add(pair);
        }
      }
    }

    for (const name of SYNTAX_THEMES) {
      if (darkPairMembers.has(name)) continue;

      if (LIGHT_THEMES.has(name)) {
        const pair = getThemePair(name);
        if (pair) {
          pairedLight.push(name);
        } else {
          lightOnly.push(name);
        }
      } else {
        darkOnly.push(name);
      }
    }

    return { pairedLight, lightOnly, darkOnly };
  }, []);
}

function PairedThemeTile({
  isActive,
  lightName,
  lightVars,
  darkVars,
  onSelect,
}: {
  isActive: boolean;
  lightName: SyntaxThemeName;
  lightVars: ThemePreviewVars | null;
  darkVars: ThemePreviewVars | null;
  onSelect: () => void;
}) {
  const darkName = getThemePair(lightName);
  return (
    <button
      aria-pressed={isActive}
      className="group flex w-[148px] shrink-0 flex-col items-center text-center focus-visible:outline-hidden"
      data-testid={`theme-pair-${lightName}`}
      onClick={onSelect}
      type="button"
    >
      <SystemPreferencePreviewFrame
        className={cn(
          "h-[98px] w-[148px] transition-shadow",
          isActive
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : "group-hover:ring-2 group-hover:ring-border",
        )}
        darkGradient={darkName ? RITUAL_GRADIENT_STOPS[darkName] : undefined}
        darkVars={darkVars}
        lightGradient={RITUAL_GRADIENT_STOPS[lightName]}
        lightVars={lightVars}
      />
      <span
        className={cn(
          "mt-1.5 w-full truncate text-xs",
          isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {pairedThemeLabel(lightName)}
      </span>
    </button>
  );
}

function SingleThemeTile({
  isActive,
  name,
  vars,
  onSelect,
}: {
  isActive: boolean;
  name: SyntaxThemeName;
  vars: ThemePreviewVars | null;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isActive}
      className="group flex w-[148px] shrink-0 flex-col items-center text-center focus-visible:outline-hidden"
      data-testid={`theme-option-${name}`}
      onClick={onSelect}
      type="button"
    >
      <ThemePreviewFrame
        className={cn(
          "h-[98px] w-[148px] transition-shadow",
          isActive
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : "group-hover:ring-2 group-hover:ring-border",
        )}
        sidebarGradient={RITUAL_GRADIENT_STOPS[name]}
        vars={vars}
      />
      <span
        className={cn(
          "mt-1.5 w-full truncate text-xs",
          isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {formatThemeLabel(name)}
      </span>
    </button>
  );
}

type AppearanceMode = "system" | "light" | "dark";

const ACCENT_PICKER_TRANSITION = {
  duration: 0.16,
  ease: [0.23, 1, 0.32, 1] as const,
};

function AccentPickerContent({
  accentColor,
  isDark,
  setAccentColor,
}: {
  accentColor: string;
  isDark: boolean;
  setAccentColor: (value: string) => void;
}) {
  return (
    <div className="shrink-0 px-1 pb-2 pt-1" data-testid="accent-color-picker">
      <h3 className="mb-2 text-sm font-medium text-foreground">Accent color</h3>
      <div className="flex flex-wrap gap-2 p-1">
        {ACCENT_COLORS.map((color) => {
          const isNeutral = color.value === "neutral";
          const swatchColor = isNeutral
            ? "hsl(var(--foreground))"
            : color.value;
          const checkClassName =
            isNeutral && isDark ? "text-black" : "text-white";

          return (
            <button
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border border-border/50 transition-transform hover:scale-110",
                accentColor === color.value &&
                  "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
              data-testid={`accent-color-${color.name.toLowerCase()}`}
              key={color.value}
              onClick={() => setAccentColor(color.value)}
              style={{ backgroundColor: swatchColor }}
              title={color.name}
              type="button"
            >
              {accentColor === color.value ? (
                <Check className={cn("h-4 w-4", checkClassName)} />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  const {
    setTheme,
    selectedThemeName,
    themeName,
    isDark,
    accentColor,
    setAccentColor,
    followSystem,
    setFollowSystem,
  } = useRitualTheme();

  const accentPickerHidden = isRitualTheme(themeName);
  const shouldReduceMotion = useReducedMotion();
  const previewVarsByTheme = useThemePreviewVars();
  const { pairedLight, lightOnly, darkOnly } = useThemeCategories();

  const activeMode: AppearanceMode = followSystem
    ? "system"
    : isDark
      ? "dark"
      : "light";

  const [selectedMode, setSelectedMode] = useState<AppearanceMode>(activeMode);

  const getVars = (name: SyntaxThemeName) =>
    withAccentPreviewVars(
      previewVarsByTheme[name] ?? getThemeFallbackPreviewVars(name),
      accentPickerHidden ? "neutral" : accentColor,
    );

  const allLightThemes = useMemo(
    () => [...pairedLight, ...lightOnly],
    [pairedLight, lightOnly],
  );

  const allDarkThemes = useMemo(() => {
    const pairedDark = pairedLight
      .map((l) => getThemePair(l))
      .filter(Boolean) as SyntaxThemeName[];
    return [...pairedDark, ...darkOnly];
  }, [pairedLight, darkOnly]);

  const handleModeSelect = (mode: AppearanceMode) => {
    setSelectedMode(mode);
    if (mode === "system") {
      setFollowSystem(true);
      const pair = getThemePair(selectedThemeName as SyntaxThemeName);
      if (!pair && pairedLight.length > 0) {
        setTheme(pairedLight[0]);
      }
    } else {
      setFollowSystem(false);
      const currentIsLight = LIGHT_THEMES.has(
        selectedThemeName as SyntaxThemeName,
      );
      const needsDark = mode === "dark" && currentIsLight;
      const needsLight = mode === "light" && !currentIsLight;
      if (needsDark || needsLight) {
        const pair = getThemePair(selectedThemeName as SyntaxThemeName);
        if (pair) {
          setTheme(pair);
        } else {
          const fallback = needsDark ? allDarkThemes[0] : allLightThemes[0];
          if (fallback) {
            setTheme(fallback);
          }
        }
      }
    }
  };

  const handleSelectTheme = (name: SyntaxThemeName) => {
    setTheme(name);
    if (selectedMode === "system") {
      setFollowSystem(true);
    } else {
      setFollowSystem(false);
    }
  };

  const isPairActive = (lightName: SyntaxThemeName) => {
    const darkName = getThemePair(lightName);
    return selectedThemeName === lightName || selectedThemeName === darkName;
  };

  return (
    <section className="space-y-4" data-testid="settings-theme">
      <p className="text-[12px] text-muted-foreground">
        Choose a theme for Ritual. Chrome materials (frosted glass, etc.) stay
        independent below.
      </p>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { mode: "system" as const, label: "System", Icon: SunMoon },
            { mode: "light" as const, label: "Light", Icon: Sun },
            { mode: "dark" as const, label: "Dark", Icon: Moon },
          ] as const
        ).map(({ mode, label, Icon }) => (
          <button
            aria-pressed={selectedMode === mode}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              selectedMode === mode
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
            )}
            data-testid={`appearance-mode-${mode}`}
            key={mode}
            onClick={() => handleModeSelect(mode)}
            type="button"
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="relative">
        <div className="max-h-[360px] overflow-y-auto rounded-lg pt-1">
          <div className="flex flex-wrap gap-3 p-1">
            {selectedMode === "system" &&
              pairedLight.map((lightName) => {
                const darkName = getThemePair(lightName);
                if (!darkName) return null;
                return (
                  <PairedThemeTile
                    darkVars={getVars(darkName)}
                    isActive={isPairActive(lightName)}
                    key={lightName}
                    lightName={lightName}
                    lightVars={getVars(lightName)}
                    onSelect={() => handleSelectTheme(lightName)}
                  />
                );
              })}
            {selectedMode === "light" &&
              allLightThemes.map((name) => (
                <SingleThemeTile
                  isActive={selectedThemeName === name}
                  key={name}
                  name={name}
                  onSelect={() => handleSelectTheme(name)}
                  vars={getVars(name)}
                />
              ))}
            {selectedMode === "dark" &&
              allDarkThemes.map((name) => (
                <SingleThemeTile
                  isActive={selectedThemeName === name}
                  key={name}
                  name={name}
                  onSelect={() => handleSelectTheme(name)}
                  vars={getVars(name)}
                />
              ))}
          </div>
        </div>
      </div>

      {shouldReduceMotion ? (
        accentPickerHidden ? null : (
          <AccentPickerContent
            accentColor={accentColor}
            isDark={isDark}
            setAccentColor={setAccentColor}
          />
        )
      ) : (
        <AnimatePresence initial={false}>
          {accentPickerHidden ? null : (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="will-change-[opacity,transform]"
              exit={{ opacity: 0, y: -10 }}
              initial={{ opacity: 0, y: -10 }}
              key="accent-picker"
              transition={ACCENT_PICKER_TRANSITION}
            >
              <AccentPickerContent
                accentColor={accentColor}
                isDark={isDark}
                setAccentColor={setAccentColor}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </section>
  );
}
