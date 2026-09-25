import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Local QuantVeda build config (Figma Make plugins stripped).
export default defineConfig({
  base: './',
  build: {
    outDir: path.resolve(import.meta.dirname, '../frontend'),
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
