import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a1f1c',
        ink2: '#0d2522',
        gold: '#c9a961',
        gold2: '#d4b673',
        cream: '#f5f1e8',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Montserrat', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
