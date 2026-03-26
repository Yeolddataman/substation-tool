import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development: Vite runs on :5173, Express on :3001.
// The proxy forwards /api/* requests to Express so the browser sees
// everything on one origin and no CORS headers are needed.
//
// In production: `npm run build` outputs dist/, then `npm run server`
// has Express serve dist/ as static files on :3001 (or $PORT).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
