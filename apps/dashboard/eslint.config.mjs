import nextVitals from "eslint-config-next/core-web-vitals";

const config = [...nextVitals];

config.push({
  rules: {
    // Stabilization pass for Next 16 + ESLint 9 migration:
    // keep behavior unchanged and prevent new strict rules from blocking lint.
    "react-hooks/exhaustive-deps": "off",
    "@next/next/no-img-element": "off",
    "react-hooks/incompatible-library": "off",
    "react/no-unescaped-entities": "warn",
    "@next/next/no-html-link-for-pages": "warn",
    "react-hooks/purity": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/error-boundaries": "warn",
  },
});

export default config;
