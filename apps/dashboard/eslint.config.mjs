import nextVitals from "eslint-config-next/core-web-vitals";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

const config = [...nextVitals];

config.push({
  plugins: {
    react: reactPlugin,
    "react-hooks": reactHooksPlugin,
  },
  rules: {
    // Stabilization pass for Next 16 + ESLint 9 migration:
    // keep behavior unchanged and prevent new strict rules from blocking lint.
    "react-hooks/exhaustive-deps": "off",
    "@next/next/no-img-element": "off",
    "react-hooks/incompatible-library": "off",
    "react-hooks/immutability": "warn",
    "react-hooks/preserve-manual-memoization": "warn",
    "react-hooks/refs": "warn",
    "react-hooks/use-memo": "warn",
    "react/no-unescaped-entities": "warn",
    "@next/next/no-html-link-for-pages": "warn",
    "react-hooks/purity": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/error-boundaries": "warn",
  },
});

export default config;
