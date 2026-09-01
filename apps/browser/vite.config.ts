import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4712,
    strictPort: true,
    proxy: {
      '/health': {
        target: 'http://127.0.0.1:4713',
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4712,
    strictPort: true,
  },
});
