import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/* Todos los valores salen de variables CSS de src/styles/tokens.css: aquí solo se les da nombre. */
const color = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "var(--gutter)",
      // Literal: `var()` NO es válido dentro de una media query (la regla se descarta y el contenedor se estira a 1920 px).
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      fontSize: {
        "display-xl": ["var(--text-display-xl)", { lineHeight: "1.05", letterSpacing: "-0.01em" }],
        "display-lg": ["var(--text-display-lg)", { lineHeight: "1.1", letterSpacing: "-0.01em" }],
        "display-md": ["var(--text-display-md)", { lineHeight: "1.15" }],
        "display-sm": ["var(--text-display-sm)", { lineHeight: "1.25" }],
      },
      letterSpacing: { eyebrow: "var(--tracking-eyebrow)" },
      colors: {
        border: color("border"),
        input: color("input"),
        ring: color("ring"),
        background: color("background"),
        foreground: color("foreground"),
        card: { DEFAULT: color("card"), foreground: color("card-foreground") },
        popover: { DEFAULT: color("popover"), foreground: color("popover-foreground") },
        primary: { DEFAULT: color("primary"), foreground: color("primary-foreground") },
        secondary: { DEFAULT: color("secondary"), foreground: color("secondary-foreground") },
        muted: { DEFAULT: color("muted"), foreground: color("muted-foreground") },
        accent: { DEFAULT: color("accent"), foreground: color("accent-foreground") },
        destructive: {
          DEFAULT: color("destructive"),
          foreground: color("destructive-foreground"),
          soft: color("destructive-soft"),
        },
        success: { DEFAULT: color("success"), soft: color("success-soft") },
        warning: { DEFAULT: color("warning"), soft: color("warning-soft") },
        info: { DEFAULT: color("info"), soft: color("info-soft") },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: { standard: "var(--ease-standard)" },
      spacing: { section: "var(--section-y)", header: "var(--header-height)" },
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
        "accordion-down": "accordion-down var(--duration-base) var(--ease-standard)",
        "accordion-up": "accordion-up var(--duration-base) var(--ease-standard)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
