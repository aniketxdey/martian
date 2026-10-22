/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0A0A0B', 2: '#141517', 3: '#1C1D20', line: '#26282C' },
        canvas: '#F7F7F5',
        surface: '#FFFFFF',
        line: { DEFAULT: '#E6E6E3', soft: '#EFEFEC', strong: '#D4D4D0' },
        fg: { DEFAULT: '#111214', 2: '#2A2C30', body: '#45484E', muted: '#5B5F66', faint: '#6B6F76' },
        side: { muted: '#A9ACB2', dim: '#8E9198' },
        accent: { DEFAULT: '#D2401A', soft: '#FF6B3D', wash: '#FBEDE7', ink: '#8A3412', link: '#B4361A' },
        ok: { DEFAULT: '#15803D', wash: '#E8F5EC', dot: '#22C55E', side: '#4ADE80', sideText: '#9FE0BC' },
        warn: { DEFAULT: '#B45309', ink: '#92400E', wash: '#FDF3E1' },
        danger: { DEFAULT: '#B91C1C', line: '#E8B4B4', soft: '#F3D0D0' },
        chip: '#F2F2EF',
      },
      fontFamily: {
        sans: ['"Geist Sans"', 'Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        drawer: '-24px 0 60px rgba(10,10,11,0.18)',
        dialog: '0 30px 80px rgba(10,10,11,0.3)',
        tab: '0 1px 2px rgba(17,18,20,0.08)',
        composer: '0 6px 24px rgba(17,18,20,0.05)',
      },
    },
  },
  plugins: [],
}
