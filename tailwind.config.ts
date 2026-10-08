import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: [
          "azo-sans-web",
          "Open Sans",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        black: "#161514", // brand warm near-black (site #161514) instead of pure #000
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* ------------------------------------------------------------------
         * Intense Care brand ramps — sole truth: https://intensecare.in/
         * cream paper #fdfbf8 · ink #262626 · coral #ea506c · maroon #61170f
         * Warm the whole neutral stack off slate/zinc blue-greys so every
         * surface reads as the marketing site's paper, not default Tailwind.
         *
         * Discipline pass: zinc is an exact alias of slate (one neutral), and
         * indigo/violet/purple/sky alias the brick family while teal aliases
         * emerald — so class names across the app resolve to at most
         * neutral · brand-brick · green(success) · amber(waiting) · red(alert)
         * · coral(brand accent). No rainbow.
         * ------------------------------------------------------------------ */
        slate: {
          50: "#fdfbf8", // brand cream — page paper
          100: "#f8f4ed",
          200: "#efe9df", // hairline borders
          300: "#e1d9cd",
          400: "#877a68", // muted labels/small type — readable on cream (was #c3b8a9 → #a89b89, still too light per client)
          500: "#746757",
          600: "#615647",
          700: "#4c443a",
          800: "#413a34",
          900: "#262626", // brand ink
          950: "#161514", // brand near-black
        },
        zinc: {
          // exact alias of slate — one neutral everywhere
          50: "#fdfbf8",
          100: "#f8f4ed",
          200: "#efe9df",
          300: "#e1d9cd",
          400: "#877a68", // muted labels/small type — readable on cream (was #c3b8a9 → #a89b89, still too light per client)
          500: "#746757",
          600: "#615647",
          700: "#4c443a",
          800: "#413a34",
          900: "#262626",
          950: "#161514", // sidebar / dark chrome
        },
        /* Brand accent: coral #ea506c → maroon #61170f (site gradient pair) */
        rose: {
          50: "#fef2f4",
          100: "#fde3e7",
          200: "#fbc7cf",
          300: "#f7a1b0",
          400: "#f0738a",
          500: "#ea506c", // brand coral
          600: "#d63c58",
          700: "#ab2f3a",
          800: "#7d2a20",
          900: "#61170f", // brand maroon
          950: "#43110b",
        },
        /* --------------------------------------------------------------
         * Info/accent family (blue, indigo, purple, violet, sky) is an
         * exact alias of the CORAL brand ramp (#ea506c) — per client
         * direction, coral + white are the primary colors, so every
         * former brick/maroon chip, icon and link resolves to coral.
         * Green = success · amber = waiting · red = danger only.
         * -------------------------------------------------------------- */
        blue: {
          50: "#fef2f4",
          100: "#fde3e7",
          200: "#fbc7cf",
          300: "#f7a1b0",
          400: "#f0738a",
          500: "#ea506c",
          600: "#d63c58",
          700: "#c33751",
          800: "#a83147",
          900: "#8c2b3d",
        },
        /* Aliased to the coral ramp above — info/tinted chips resolve here */
        indigo: {
          50: "#fef2f4",
          100: "#fde3e7",
          200: "#fbc7cf",
          300: "#f7a1b0",
          400: "#f0738a",
          500: "#ea506c",
          600: "#d63c58",
          700: "#c33751",
          800: "#a83147",
          900: "#8c2b3d",
          950: "#5c1d29",
        },
        purple: {
          50: "#fef2f4",
          100: "#fde3e7",
          200: "#fbc7cf",
          300: "#f7a1b0",
          400: "#f0738a",
          500: "#ea506c",
          600: "#d63c58",
          700: "#c33751",
          800: "#a83147",
          900: "#8c2b3d",
          950: "#5c1d29",
        },
        violet: {
          50: "#fef2f4",
          100: "#fde3e7",
          200: "#fbc7cf",
          300: "#f7a1b0",
          400: "#f0738a",
          500: "#ea506c",
          600: "#d63c58",
          700: "#c33751",
          800: "#a83147",
          900: "#8c2b3d",
          950: "#5c1d29",
        },
        sky: {
          50: "#fef2f4",
          100: "#fde3e7",
          200: "#fbc7cf",
          300: "#f7a1b0",
          400: "#f0738a",
          500: "#ea506c",
          600: "#d63c58",
          700: "#c33751",
          800: "#a83147",
          900: "#8c2b3d",
          950: "#5c1d29",
        },
        /* Aliased to emerald — success-family chips (CUSTOMER_SIGNED etc.) */
        teal: {
          50: "#f0f7f2",
          100: "#dceee3",
          200: "#b9ddc9",
          300: "#8cc8a7",
          400: "#5cab83",
          500: "#39916b",
          600: "#2c7758",
          700: "#256149",
          800: "#1f4e3c",
          900: "#1a4031",
          950: "#0e2a20",
        },
        /* Warm green — success/pass/paid (de-neoned to sit on cream) */
        emerald: {
          50: "#f0f7f2",
          100: "#dceee3",
          200: "#b9ddc9",
          300: "#8cc8a7",
          400: "#5cab83",
          500: "#39916b",
          600: "#2c7758",
          700: "#256149",
          800: "#1f4e3c",
          900: "#1a4031",
          950: "#0e2a20",
        },
        /* Amber — waiting/warning (deepened for cream paper) */
        amber: {
          50: "#fdf6ec",
          100: "#fbead1",
          200: "#f6d5a7",
          300: "#efbb74",
          400: "#e69d47",
          500: "#dc8427",
          600: "#bc6b1d",
          700: "#985418",
          800: "#7a4417",
          900: "#633715",
          950: "#3d220c",
        },
        /* Red — destructive only (warmed, less neon) */
        red: {
          50: "#fef2f2",
          100: "#fde2e2",
          200: "#facaca",
          300: "#f5a2a2",
          400: "#ec7171",
          500: "#e04b4b",
          600: "#cd3232",
          700: "#ac2727",
          800: "#8d2222",
          900: "#742121",
          950: "#461111",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
