/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Plain Vite + React config. No backend — this app only ever talks to
// itself, the Web Audio API, and (for the practice section) the browser's
// IndexedDB.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
