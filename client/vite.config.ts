import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    // Source maps reveal dev comments and make reverse-engineering chain-validation
    // logic trivial. Emit privately for debugging (mode-gated) but not to prod.
    sourcemap: process.env.NODE_ENV === 'production' ? false : true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    exclude: ['node_modules', 'dist', 'e2e'],
    passWithNoTests: true,
  },
});
