/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        sidebar: "rgb(var(--sidebar-rgb) / <alpha-value>)",
        elevated: "rgb(var(--elevated-rgb) / <alpha-value>)",
        hover: "var(--hover)",
        active: "var(--active)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        muted: "rgb(var(--muted-rgb) / <alpha-value>)",
        faint: "rgb(var(--faint-rgb) / <alpha-value>)",
        line: "rgb(var(--line-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-hover-rgb) / <alpha-value>)",
        "accent-soft": "var(--accent-soft)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        "danger-soft": "var(--danger-soft)",
        success: "rgb(var(--success-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Segoe UI Variable Text",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: ["Cascadia Code", "Cascadia Mono", "Consolas", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "14px"],
      },
      boxShadow: {
        pop: "0 8px 28px rgba(15, 23, 42, 0.12), 0 1px 3px rgba(15, 23, 42, 0.08)",
        modal: "0 24px 64px rgba(15, 23, 42, 0.22), 0 2px 8px rgba(15, 23, 42, 0.10)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.98)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "dot-pulse": {
          "0%, 80%, 100%": { opacity: "0.25" },
          "40%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.2s ease-out",
        "fade-in": "fade-in 0.15s ease-out",
        "scale-in": "scale-in 0.16s ease-out",
        "slide-in-left": "slide-in-left 0.2s ease-out",
        "dot-pulse": "dot-pulse 1.2s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};
