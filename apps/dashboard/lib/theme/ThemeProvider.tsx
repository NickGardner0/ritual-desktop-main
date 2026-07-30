"use client";

/**
 * Ritual theme provider — Shiki-derived CSS vars + accent + system follow.
 *
 * Adapted from Block Buzz (Apache-2.0):
 * https://github.com/block/buzz — desktop/src/shared/theme/ThemeProvider.tsx
 * (Tauri vibrancy / Buzz translucency sequencing omitted; Ritual chrome
 * materials remain owned by ChromeAppearanceContext.)
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createThemeVars, hexToHsl } from "./adaptive-theme";
import {
  type SyntaxThemeName,
  extractThemeInfo,
  getThemePair,
  loadThemeData,
  resolveSystemTheme,
} from "./theme-loader";
import { SYNTAX_THEMES } from "./theme-loader";

export const THEME_STORAGE_KEY = "ritual-theme";
const CACHE_KEY = "ritual-theme-cache";
export const ACCENT_STORAGE_KEY = "ritual-accent-color";
export const NEUTRAL_ACCENT = "neutral";
const FOLLOW_SYSTEM_KEY = "ritual-follow-system";
const THEME_CHANNEL_NAME = "ritual-theme";

export const ACCENT_COLORS = [
  { name: "Neutral", value: NEUTRAL_ACCENT },
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Lilac", value: "#c0a2f1" },
  { name: "Purple", value: "#a855f7" },
  { name: "Indigo", value: "#6366f1" },
] as const;

const DEFAULT_ACCENT = "#3b82f6";

type ThemeContextValue = {
  themeName: string;
  selectedThemeName: string;
  isDark: boolean;
  isLoading: boolean;
  accentColor: string;
  followSystem: boolean;
  hasPair: boolean;
  setTheme: (name: string) => void;
  setAccentColor: (color: string) => void;
  setFollowSystem: (enabled: boolean) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: SyntaxThemeName;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isValidThemeName(name: string): name is SyntaxThemeName {
  return (SYNTAX_THEMES as readonly string[]).includes(name);
}

function readStoredTheme(fallback: SyntaxThemeName): SyntaxThemeName {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (!stored) return fallback;

  if (stored === "light") return "ritual";
  if (stored === "dark" || stored === "system") return "ritual-dark";
  if (stored === "buzz") return "ritual";
  if (stored === "buzz-dark") return "ritual-dark";

  return isValidThemeName(stored) ? stored : fallback;
}

function getContrastColor(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
  if (!m) return "#ffffff";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? "#000000" : "#ffffff";
}

function applyAccentColor(value: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (value === NEUTRAL_ACCENT) {
    const styles = window.getComputedStyle(root);
    const foreground = styles.getPropertyValue("--foreground").trim();
    const background = styles.getPropertyValue("--background").trim();
    root.style.setProperty("--primary", foreground);
    root.style.setProperty("--primary-foreground", background);
    root.style.setProperty("--sidebar-primary", foreground);
    root.style.setProperty("--sidebar-primary-foreground", background);
    root.style.setProperty("--sidebar-active", foreground);
    root.style.setProperty("--sidebar-active-foreground", background);
    return;
  }

  const accentHsl = hexToHsl(value);
  const fgHsl = hexToHsl(getContrastColor(value));
  root.style.setProperty("--primary", accentHsl);
  root.style.setProperty("--primary-foreground", fgHsl);
  root.style.setProperty("--sidebar-primary", accentHsl);
  root.style.setProperty("--sidebar-primary-foreground", fgHsl);
  root.style.setProperty("--sidebar-active", accentHsl);
  root.style.setProperty("--sidebar-active-foreground", fgHsl);
}

/** Ritual brand themes pin a neutral accent (same role as Buzz themes). */
export function isRitualTheme(themeName: string): boolean {
  return themeName === "ritual" || themeName === "ritual-dark";
}

function resolveEffectiveAccent(
  themeName: string,
  accentColor: string,
): string {
  return isRitualTheme(themeName) ? NEUTRAL_ACCENT : accentColor;
}

function applyRitualBrandMarker(themeName: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isRitualTheme(themeName)) {
    root.setAttribute("data-ritual-theme", themeName);
  } else {
    root.removeAttribute("data-ritual-theme");
  }
}

/** Apply cached CSS vars synchronously to prevent FOUC. */
export function applyCachedVars(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const { themeName, vars, isDark } = JSON.parse(cached) as {
      themeName: string;
      vars: Record<string, string>;
      isDark: boolean;
    };
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    root.classList.remove("light", "dark");
    root.classList.add(isDark ? "dark" : "light");
    applyRitualBrandMarker(themeName);

    const accent =
      window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
    applyAccentColor(resolveEffectiveAccent(themeName, accent));

    return themeName;
  } catch {
    return null;
  }
}

let themeApplyRequest = 0;

async function applyTheme(
  name: SyntaxThemeName,
): Promise<{ isDark: boolean } | null> {
  const requestToken = ++themeApplyRequest;
  const themeData = await loadThemeData(name);
  if (requestToken !== themeApplyRequest) return null;

  const info = extractThemeInfo(name, themeData);
  const { isDark, vars } = createThemeVars(info.bg, info.fg, info.comment, {
    added: info.added,
    deleted: info.deleted,
    modified: info.modified,
  });

  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  root.classList.remove("light", "dark");
  root.classList.add(isDark ? "dark" : "light");
  applyRitualBrandMarker(name);

  applyAccentColor(
    resolveEffectiveAccent(
      name,
      window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT,
    ),
  );

  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ themeName: name, vars, isDark }),
    );
  } catch {
    // Storage full — non-critical
  }

  return { isDark };
}

export function RitualThemeProvider({
  children,
  defaultTheme = "ritual",
}: ThemeProviderProps) {
  const [selectedTheme, setSelectedTheme] = useState<string>(() => {
    applyCachedVars();
    return readStoredTheme(defaultTheme);
  });
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });
  const [isLoading, setIsLoading] = useState(true);
  const loadingRef = useRef<string | null>(null);
  const [accentColor, setAccentColorState] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_ACCENT;
    return window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
  });
  const [followSystem, setFollowSystemState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(FOLLOW_SYSTEM_KEY);
    if (stored !== null) return stored === "true";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === null;
  });
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const effectiveTheme = (() => {
    if (!followSystem || !isValidThemeName(selectedTheme)) return selectedTheme;
    return resolveSystemTheme(selectedTheme as SyntaxThemeName, systemIsDark);
  })();

  const hasPair = isValidThemeName(selectedTheme)
    ? getThemePair(selectedTheme as SyntaxThemeName) !== null
    : false;

  useEffect(() => {
    if (!isValidThemeName(effectiveTheme)) return;

    const thisTheme = effectiveTheme;
    loadingRef.current = thisTheme;
    setIsLoading(true);

    void applyTheme(effectiveTheme as SyntaxThemeName).then((result) => {
      if (!result) return;
      if (loadingRef.current === thisTheme) {
        setIsDark(result.isDark);
        setIsLoading(false);
      }
    });
  }, [effectiveTheme]);

  useEffect(() => {
    if (!followSystem) return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setSystemIsDark(event.matches);
    };

    setSystemIsDark(mq.matches);
    mq.addEventListener("change", handleMediaChange);
    return () => {
      mq.removeEventListener("change", handleMediaChange);
    };
  }, [followSystem]);

  useEffect(() => {
    applyAccentColor(resolveEffectiveAccent(effectiveTheme, accentColor));
  }, [accentColor, effectiveTheme]);

  // Settings is a separate Tauri webview — sync theme/accent/follow across windows.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromStorage = () => {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme && isValidThemeName(storedTheme)) {
        setSelectedTheme(storedTheme);
      }
      const storedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
      if (storedAccent) {
        setAccentColorState(storedAccent);
      }
      const storedFollow = window.localStorage.getItem(FOLLOW_SYSTEM_KEY);
      if (storedFollow !== null) {
        setFollowSystemState(storedFollow === "true");
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === THEME_STORAGE_KEY ||
        event.key === ACCENT_STORAGE_KEY ||
        event.key === FOLLOW_SYSTEM_KEY ||
        event.key === CACHE_KEY
      ) {
        syncFromStorage();
        applyCachedVars();
      }
    };

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(THEME_CHANNEL_NAME);
      channel.onmessage = () => {
        syncFromStorage();
        applyCachedVars();
      };
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      channel?.close();
    };
  }, []);

  const broadcastThemeChange = useCallback(() => {
    try {
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel(THEME_CHANNEL_NAME);
        channel.postMessage({ type: "theme-changed" });
        channel.close();
      }
    } catch {
      // Ignore broadcast failures (private mode / unsupported).
    }
  }, []);

  const setTheme = useCallback(
    (name: string) => {
      if (!isValidThemeName(name)) return;
      setSelectedTheme(name);
      window.localStorage.setItem(THEME_STORAGE_KEY, name);
      broadcastThemeChange();
    },
    [broadcastThemeChange],
  );

  const setAccentColor = useCallback(
    (color: string) => {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, color);
      setAccentColorState(color);
      broadcastThemeChange();
    },
    [broadcastThemeChange],
  );

  const setFollowSystem = useCallback(
    (enabled: boolean) => {
      window.localStorage.setItem(FOLLOW_SYSTEM_KEY, enabled ? "true" : "false");
      setFollowSystemState(enabled);
      broadcastThemeChange();
    },
    [broadcastThemeChange],
  );

  const value: ThemeContextValue = {
    themeName: effectiveTheme,
    selectedThemeName: selectedTheme,
    isDark,
    isLoading,
    accentColor,
    followSystem,
    hasPair,
    setTheme,
    setAccentColor,
    setFollowSystem,
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useRitualTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useRitualTheme must be used within a RitualThemeProvider");
  }
  return context;
}

/** Optional hook that returns null outside the provider (e.g. sonner). */
export function useRitualThemeOptional() {
  return useContext(ThemeContext);
}
