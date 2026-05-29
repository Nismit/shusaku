import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        stableFluid: resolve(__dirname, 'src/stableFluid/index.html'),
        fluidGallery: resolve(__dirname, 'src/fluidGallery/index.html'),
        ambientClock: resolve(__dirname, 'src/ambientClock/index.html'),
        tunnelRaymarching: resolve(__dirname, 'src/tunnelRaymarching/index.html'),
        mixFunctions: resolve(__dirname, 'src/mixFunctions/index.html'),
        volumetricSmoke: resolve(__dirname, 'src/volumetricSmoke/index.html'),
      },
    },
  },
});
