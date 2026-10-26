/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Martian API base URL, e.g. "/api" (dev proxy) or "https://api.martian-ai.com". Unset = demo data. */
  readonly VITE_API_URL?: string;
}
