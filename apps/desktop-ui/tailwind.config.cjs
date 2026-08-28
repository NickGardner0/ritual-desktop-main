/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@ritual/ui/tailwind-config")],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../dashboard/app/**/*.{ts,tsx}",
    "../dashboard/components/**/*.{ts,tsx}",
    "../dashboard/lib/**/*.{ts,tsx}",
    "../dashboard/contexts/**/*.{ts,tsx}",
    "../dashboard/hooks/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'FK Grotesk Neue'", '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
