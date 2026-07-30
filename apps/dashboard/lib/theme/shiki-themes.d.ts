/**
 * Ambient module declarations for Shiki theme JSON entrypoints.
 * Dashboard tsconfig uses moduleResolution "node", which does not resolve
 * package exports for `shiki/themes/*.mjs` without these shims.
 */
declare module "shiki/themes/*.mjs" {
  import type { ThemeRegistrationRaw } from "shiki";
  const theme: ThemeRegistrationRaw;
  export default theme;
}
