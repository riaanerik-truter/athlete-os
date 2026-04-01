/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#3B82F6',  // blue-500 (light mode)
          dark: '#60A5FA',     // blue-400 (dark mode)
        },
      },
    },
  },
  plugins: [],
}
