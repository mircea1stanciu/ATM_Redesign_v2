/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
          600: '#ca8a04',
          700: '#a16207',
          800: '#854d0e',
          900: '#713f12',
        },
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          800: '#1e293b',
          900: '#0f172a',
          950: '#0b1120',
        }
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)',
        'soft-lg': '0 4px 16px rgba(15,23,42,0.08), 0 12px 32px rgba(15,23,42,0.08)',
        'glow': '0 0 0 1px rgba(234,179,8,0.15), 0 8px 24px rgba(234,179,8,0.18)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #eab308 0%, #f59e0b 50%, #d97706 100%)',
        'brand-soft': 'linear-gradient(135deg, rgba(234,179,8,0.08), rgba(217,119,6,0.08))',
      },
      animation: {
        'typing': 'typing 1.4s infinite',
        'fade-in': 'fadeIn 0.4s ease both',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scaleIn 0.2s ease both',
        'shimmer': 'shimmer 1.6s linear infinite',
      },
      keyframes: {
        typing: {
          '0%, 60%, 100%': { transform: 'translateY(0)' },
          '30%': { transform: 'translateY(-10px)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      }
    },
  },
  plugins: [],
}
