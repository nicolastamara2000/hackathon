/** Colors, type and spacing come from the design tokens in src/styles/tokens.css. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        raised: v("raised"),
        line: v("line"),
        ink: v("ink"),
        muted: v("muted"),
        accent: v("accent"),
        live: v("live"),
        good: v("good"),
        warn: v("warn"),
        bad: v("bad"),
        home: v("home"),
        away: v("away"),
        pitch: v("pitch"),
      },
      fontFamily: {
        display: ['"Barlow Condensed"', "system-ui", "sans-serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
      },
      fontSize: {
        // 1.25 broadcast scale; tv-* sizes keep full-screen text at 28 px or more
        "2xs": ["11px", "14px"],
        xs: ["12px", "16px"],
        sm: ["14px", "20px"],
        base: ["16px", "24px"],
        lg: ["20px", "28px"],
        xl: ["24px", "30px"],
        "tv-sm": ["28px", "34px"],
        "tv-md": ["40px", "44px"],
        "tv-lg": ["64px", "64px"],
        "tv-xl": ["96px", "92px"],
      },
      borderRadius: { sm: "4px", DEFAULT: "8px", lg: "12px" },
      transitionTimingFunction: { broadcast: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    },
  },
  plugins: [],
};
