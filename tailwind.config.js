/** @type {import('tailwindcss').Config} */

// Every color is a CSS variable (see src/index.css) so the console can switch between
// light and dark themes and accent colors at runtime (Settings → Appearance).
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), line: v('ink-line') },
        canvas: v('canvas'),
        surface: v('surface'),
        raised: v('raised'),
        line: { DEFAULT: v('line'), soft: v('line-soft'), strong: v('line-strong') },
        fg: { DEFAULT: v('fg'), 2: v('fg-2'), body: v('fg-body'), muted: v('fg-muted'), faint: v('fg-faint') },
        side: { muted: v('side-muted'), dim: v('side-dim') },
        accent: { DEFAULT: v('accent'), soft: v('accent-soft'), wash: v('accent-wash'), ink: v('accent-ink'), link: v('accent-link') },
        ok: { DEFAULT: v('ok'), wash: v('ok-wash'), dot: v('ok-dot'), side: v('ok-side'), sideText: v('ok-side-text') },
        warn: { DEFAULT: v('warn'), ink: v('warn-ink'), wash: v('warn-wash') },
        danger: { DEFAULT: v('danger'), line: v('danger-line'), soft: v('danger-soft'), wash: v('danger-wash') },
        info: { DEFAULT: v('info'), wash: v('info-wash') },
        chip: v('chip'),
        idle: v('idle'),
      },
      fontFamily: {
        sans: ['"Geist Sans"', 'Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
        chat: ['var(--chat-font)'],
      },
      // rem sizes, so Settings → Appearance → Font size scales all text.
      fontSize: {
        11: '0.6875rem',
        13: '0.8125rem',
        15: '0.9375rem',
        17: '1.0625rem',
        19: '1.1875rem',
        22: '1.375rem',
        26: '1.625rem',
        28: '1.75rem',
        30: '1.875rem',
        chat: 'var(--chat-size)',
      },
      boxShadow: {
        drawer: '-24px 0 60px rgba(10,10,11,0.18)',
        dialog: '0 30px 80px rgba(10,10,11,0.3)',
        tab: '0 1px 2px rgba(17,18,20,0.08)',
        composer: '0 6px 24px rgba(17,18,20,0.05)',
        pop: '0 12px 32px rgba(10,10,11,0.16)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        flow: { to: { strokeDashoffset: '-24' } },
      },
      animation: {
        'fade-up': 'fade-up 240ms ease-out both',
        flow: 'flow 1.2s linear infinite',
      },
    },
  },
  plugins: [],
}
