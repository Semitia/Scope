import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  noExternal: ['ws'],
  outDir: 'dist',
  clean: false,
});
