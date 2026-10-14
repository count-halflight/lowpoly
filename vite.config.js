import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` -> dist/ (multi-file static site, relative paths so it works on any host/subpath)
// `npm run build:single` -> dist-single/index.html (everything inlined into one file)
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    assetsInlineLimit: mode === 'single' ? 100000000 : 4096,
    chunkSizeWarningLimit: 1500,
  },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
}));
