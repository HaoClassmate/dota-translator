import { defineConfig } from 'vite';

export default defineConfig({
  base: '/treasures/',
  publicDir: false,
  build: {
    outDir: '../docs/treasures',
    emptyOutDir: false,
    manifest: true,
  },
});
