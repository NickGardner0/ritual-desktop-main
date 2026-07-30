/**
 * Theme display labels for Appearance picker.
 *
 * Adapted from Block Buzz (Apache-2.0) SettingsPanels helpers.
 */

export function formatThemeLabel(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Derive a display label for a paired theme from its light variant name.
 * Strips mode-specific tokens from any position.
 */
export function pairedThemeLabel(lightName: string): string {
  if (lightName === "ritual") return "Ritual";

  const modeTokens = new Set([
    "light",
    "latte",
    "dawn",
    "lotus",
    "ochin",
    "lighter",
    "plus",
  ]);
  const parts = lightName.split("-").filter((t) => !modeTokens.has(t));
  const base = parts.length > 0 ? parts.join("-") : lightName;
  return formatThemeLabel(base);
}
