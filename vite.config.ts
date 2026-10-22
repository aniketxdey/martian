import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `VITE_API_URL=/api npm run dev` runs the console against a local API on :8000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.MARTIAN_API_PROXY ?? 'http://localhost:8000',
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
