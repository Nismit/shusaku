import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        stableFluid: resolve(__dirname, 'src/stableFluid/index.html'),
        fluidGallery: resolve(__dirname, 'src/fluidGallery/index.html'),
        tunnelRaymarching: resolve(__dirname, 'src/tunnelRaymarching/index.html'),
        mixFunctions: resolve(__dirname, 'src/mixFunctions/index.html'),
      },
    },
  },
});
