import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    target: 'esnext',
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        fluidGallery: resolve(__dirname, 'src/fluidGallery/index.html'),
        ambientClock: resolve(__dirname, 'src/ambientClock/index.html'),
        signalVein: resolve(__dirname, 'src/signalVein/index.html'),
        foldExperiments: resolve(__dirname, 'src/foldExperiments/index.html'),
        mixFunctions: resolve(__dirname, 'src/mixFunctions/index.html'),
        baitBall: resolve(__dirname, 'src/baitBall/index.html'),
        murmuration: resolve(__dirname, 'src/murmuration/index.html'),
        isometricBlocks: resolve(__dirname, 'src/isometricBlocks/index.html'),
        focalRings: resolve(__dirname, 'src/focalRings/index.html'),
        labChamber: resolve(__dirname, 'src/labChamber/index.html'),
        contourTerrain: resolve(__dirname, 'src/contourTerrain/index.html'),
        magneticField: resolve(__dirname, 'src/magneticField/index.html'),
        sounding: resolve(__dirname, 'src/sounding/index.html'),
      },
    },
  },
});
