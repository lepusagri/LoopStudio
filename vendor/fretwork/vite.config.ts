import { defineConfig } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), base: '/fretwork/',
  plugins: [alphaTab()], esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: '../../public/fretwork', emptyOutDir: true },
});
