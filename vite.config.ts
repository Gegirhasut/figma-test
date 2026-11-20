import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // The library JSON files are loaded on demand by URL, not inlined.
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
} as never);
