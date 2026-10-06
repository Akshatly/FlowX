import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/src-tauri/**', '**/dist/**', '**/*.tsbuildinfo', '**/.git/**'],
    },
  },
  clearScreen: false,
});
