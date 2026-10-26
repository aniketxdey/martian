/**
 * Appearance and chat preferences (Settings → Appearance). Stored per viewer in
 * localStorage and applied to <html> as classes and CSS variables.
 */
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type Accent = 'martian' | 'blue' | 'violet' | 'green' | 'pink' | 'graphite';
export type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type ChatFont = 'default' | 'system' | 'serif' | 'mono' | 'legible';
export type ChatSize = 'sm' | 'md' | 'lg';

export type Prefs = {
  theme: Theme;
  accent: Accent;
  fontSize: FontSize;
  chatFont: ChatFont;
  chatSize: ChatSize;
  density: 'comfortable' | 'compact';
  reduceMotion: boolean;
  highContrast: boolean;
  enterToSend: boolean;
  showSuggestions: boolean;
  showToolCalls: boolean;
  clock: '12h' | '24h';
};

export const DEFAULT_PREFS: Prefs = {
  theme: 'system', accent: 'martian', fontSize: 'md', chatFont: 'default', chatSize: 'md', density: 'comfortable',
  reduceMotion: false, highContrast: false, enterToSend: true, showSuggestions: true, showToolCalls: true, clock: '12h',
};

const KEY = 'martian.prefs.v1';

const load = (): Prefs => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
};

/** Accent palettes as RGB triplets: [accent, soft, wash, ink, link] for light, then dark. */
export const ACCENTS: Record<Accent, { label: string; swatch: string; light: string[]; dark: string[] }> = {
  martian: { label: 'Martian orange', swatch: '#D2401A', light: ['210 64 26', '255 107 61', '251 237 231', '138 52 18', '180 54 26'], dark: ['232 84 44', '255 122 80', '58 29 20', '255 181 156', '255 138 102'] },
  blue: { label: 'Blue', swatch: '#2563EB', light: ['37 99 235', '96 145 255', '232 239 253', '30 58 138', '29 78 216'], dark: ['79 134 247', '122 162 255', '23 34 64', '170 196 255', '125 165 255'] },
  violet: { label: 'Violet', swatch: '#7C3AED', light: ['124 58 237', '167 120 255', '241 234 254', '76 29 149', '109 40 217'], dark: ['150 98 245', '186 150 255', '40 26 66', '214 193 255', '186 150 255'] },
  green: { label: 'Green', swatch: '#15803D', light: ['21 128 61', '64 190 110', '232 245 236', '20 83 45', '22 101 52'], dark: ['52 178 98', '96 214 140', '18 48 30', '160 230 186', '110 214 150'] },
  pink: { label: 'Pink', swatch: '#DB2777', light: ['219 39 119', '244 114 182', '252 231 243', '131 24 67', '190 24 93'], dark: ['236 72 153', '249 140 196', '64 20 42', '251 182 216', '249 140 196'] },
  graphite: { label: 'Graphite', swatch: '#3F4148', light: ['63 65 72', '120 124 133', '238 238 236', '30 31 35', '55 57 63'], dark: ['178 182 190', '208 211 217', '42 44 49', '230 232 236', '208 211 217'] },
};

const FONT_PX: Record<FontSize, number> = { xs: 14, sm: 15, md: 16, lg: 17, xl: 18 };
const CHAT_REM: Record<ChatSize, string> = { sm: '0.875rem', md: '0.9375rem', lg: '1.0625rem' };
export const CHAT_FONTS: Record<ChatFont, { label: string; stack: string }> = {
  default: { label: 'Default', stack: '"Geist Sans", Geist, ui-sans-serif, system-ui, sans-serif' },
  system: { label: 'Match system', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { label: 'Serif', stack: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  mono: { label: 'Monospace', stack: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace' },
  legible: { label: 'Easier to read', stack: 'Verdana, "Atkinson Hyperlegible", Tahoma, "DejaVu Sans", sans-serif' },
};

const systemDark = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

export const resolvedTheme = (p: Prefs) => (p.theme === 'system' ? (systemDark() ? 'dark' : 'light') : p.theme);

/** Applies preferences to the document. Exported so main.tsx can run it before first paint. */
export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const dark = resolvedTheme(p) === 'dark';
  root.classList.toggle('dark', dark);
  root.classList.toggle('reduce-motion', p.reduceMotion);
  root.classList.toggle('high-contrast', p.highContrast);
  root.classList.toggle('density-compact', p.density === 'compact');
  root.style.setProperty('--ui-font-size', `${FONT_PX[p.fontSize]}px`);
  root.style.setProperty('--chat-font', CHAT_FONTS[p.chatFont].stack);
  root.style.setProperty('--chat-size', CHAT_REM[p.chatSize]);
  const pal = ACCENTS[p.accent][dark ? 'dark' : 'light'];
  ['accent', 'accent-soft', 'accent-wash', 'accent-ink', 'accent-link'].forEach((k, i) => root.style.setProperty(`--c-${k}`, pal[i]));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0D0E10' : '#F7F7F5');
}

export const initialPrefs = load;

type Ctx = { prefs: Prefs; set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void; reset: () => void };
const PrefsContext = createContext<Ctx>({ prefs: DEFAULT_PREFS, set: () => undefined, reset: () => undefined });

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);

  // Layout effect so a theme switch inside a view transition is painted in the new state.
  useLayoutEffect(() => {
    applyPrefs(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage off */ }
  }, [prefs]);

  // Follow the OS when the theme is "system".
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return; }
    const on = () => applyPrefs(prefs);
    mq.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, [prefs]);

  const set = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v })), []);
  const reset = useCallback(() => setPrefs(DEFAULT_PREFS), []);
  const value = useMemo(() => ({ prefs, set, reset }), [prefs, set, reset]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);

/** Clock-aware time formatting. */
export const fmtTime = (t: number | Date, clock: Prefs['clock']) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: clock === '12h' });
