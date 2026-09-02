import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'webview/main.tsx'),
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'main.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
