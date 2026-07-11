/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Palette driven by CSS variables so light & dark share one class set.
        // Variables are defined in index.css (:root = light, .dark = dark).
        macos: {
          bg: {
            primary: 'rgb(var(--bg-primary) / <alpha-value>)',
            secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
            tertiary: 'rgb(var(--bg-tertiary) / <alpha-value>)',
            elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          },
          text: {
            primary: 'rgb(var(--text-primary) / <alpha-value>)',
            secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
            tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
            quaternary: 'rgb(var(--text-quaternary) / <alpha-value>)',
          },
          accent: {
            blue: 'rgb(var(--accent-blue) / <alpha-value>)',
            green: 'rgb(var(--accent-green) / <alpha-value>)',
            red: 'rgb(var(--accent-red) / <alpha-value>)',
            orange: 'rgb(var(--accent-orange) / <alpha-value>)',
            yellow: 'rgb(var(--accent-yellow) / <alpha-value>)',
          },
          separator: 'rgb(var(--separator) / <alpha-value>)',
          overlay: 'rgba(0, 0, 0, 0.4)',
        },
        // Brand blue (matches the Z app icon)
        brand: {
          light: 'rgb(var(--brand-light) / <alpha-value>)',
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark) / <alpha-value>)',
        },
      },
      fontFamily: {
        'sf-pro': ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'macos': '8px',
        'macos-lg': '12px',
        'macos-xl': '18px',
      },
      boxShadow: {
        'macos': '0 2px 10px rgba(0, 0, 0, 0.15)',
        'macos-lg': '0 8px 30px rgba(0, 0, 0, 0.25)',
        'macos-xl': '0 20px 60px rgba(0, 0, 0, 0.35)',
        'brand': '0 6px 20px -4px rgb(var(--brand) / 0.5)',
        'brand-sm': '0 3px 10px -2px rgb(var(--brand) / 0.45)',
      },
      backdropBlur: {
        'macos': '40px',
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.1)', opacity: '0.7' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
