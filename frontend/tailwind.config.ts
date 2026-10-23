/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        fadeInUp: {
          '0%':   { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInLeft: {
          '0%':   { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-400% 0' },
          '100%': { backgroundPosition: '400% 0' },
        },
      },
      animation: {
        'fade-in-up':    'fadeInUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        'fade-in':       'fadeIn 0.25s ease-out',
        'slide-in-left': 'slideInLeft 0.25s cubic-bezier(0.16,1,0.3,1)',
        'shimmer':       'shimmer 2.2s linear infinite',
      },
    },
  },
  plugins: [],
}
