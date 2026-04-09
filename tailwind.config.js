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
        // macOS-inspired color palette
        macos: {
          bg: {
            primary: '#1c1c1e',
            secondary: '#2c2c2e',
            tertiary: '#3a3a3c',
            elevated: '#1c1c1e',
          },
          text: {
            primary: '#ffffff',
            secondary: '#ebebf5',
            tertiary: '#ebebf599',
            quaternary: '#ebebf54d',
          },
          accent: {
            blue: '#007aff',
            green: '#34c759',
            red: '#ff3b30',
            orange: '#ff9500',
            yellow: '#ffcc00',
          },
          separator: '#38383a',
          overlay: 'rgba(0, 0, 0, 0.4)',
        },
      },
      fontFamily: {
        'sf-pro': ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'macos': '6px',
        'macos-lg': '10px',
        'macos-xl': '14px',
      },
      boxShadow: {
        'macos': '0 2px 10px rgba(0, 0, 0, 0.15)',
        'macos-lg': '0 8px 30px rgba(0, 0, 0, 0.25)',
        'macos-xl': '0 20px 60px rgba(0, 0, 0, 0.35)',
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
