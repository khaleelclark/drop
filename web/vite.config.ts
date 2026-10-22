import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: { '/api': { target: process.env.HOUSEHOLD_API_PROXY || 'http://127.0.0.1:8787', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: true },
  test: { exclude: ['e2e/**', 'node_modules/**', 'dist/**'], environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], restoreMocks: true },
})
