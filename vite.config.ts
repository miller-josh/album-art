import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend is served by Vite in dev and built to static assets for Vercel.
// `/api/*` is handled by serverless functions in production; in local dev it is
// proxied to the standalone dev-server harness (npm run dev:api) on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
