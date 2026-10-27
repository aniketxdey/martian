/**
 * How this build of the console runs.
 *
 * - LIVE: VITE_API_URL is set, so the console talks to the Martian API.
 * - EMBED: `npm run build:embed` (mode "embed") or `?embed=1`. A static, deterministic
 *   demo with no sign-in, meant to be framed on the marketing site.
 * - Demo data: always on without an API; with an API it follows MARTIAN_DEMO_MODE
 *   (read at runtime from GET /demo/config).
 */
import { API_URL } from '../api/client';

const params = (() => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
})();

export const EMBED = import.meta.env.MODE === 'embed' || params.get('embed') === '1';
/** Live API calls are off in embed mode even when the build has an API URL. */
export const LIVE = Boolean(API_URL) && !EMBED;

/** Fixed world for the embed so every visitor sees the same, reproducible demo. */
export const EMBED_SEED = 20261026;
export const EMBED_VARIANT = 0;

const num = (v: string | null) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
export const URL_SEED = num(params.get('seed'));
/** `?variant=` takes 1–5 or a template key such as "helix"; resolved in the demo store. */
export const URL_VARIANT = params.get('variant');

/** Files in /public, resolved against the build's base so sub-path hosting works. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
