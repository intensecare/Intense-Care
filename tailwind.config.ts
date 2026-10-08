import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Forest green — the single brand color.
        brand: {
          50: "#eef7f1",
          100: "#d6ecdd",
          200: "#acd8bb",
          500: "#2f855a",
          600: "#22704a",
          700: "#1b5e3f",
          800: "#164c34",
          900: "#103a28",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
