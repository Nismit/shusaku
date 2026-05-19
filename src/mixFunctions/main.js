import { chottoGL } from '../libs/esChottoGL.js';
import { Timer } from '../libs/Timer.js';
import GUI from '../libs/lil-gui.esm.min.js';

import mainFragment from './shaders/main.frag?raw';

// Function names for reference overlay
const FUNCTION_NAMES = [
  // Row 1: Basic
  'linear (uv.x)',
  'step(0.5, uv.x)',
  'smoothstep',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  // Row 2: Easing + Trig
  'easeInCubic',
  'easeOutCubic',
  'easeInExpo',
  'easeOutExpo',
  'sin wave',
  'cos wave',
  // Row 3: Vector + Noise
  'dot',
  'length',
  'distance',
  'value noise',
  'fBM (3 oct)',
  'fBM (6 oct)',
  // Row 4: Pattern + Advanced
  'checker',
  'gradient noise',
  'radial',
  'angle',
  'domain warp',
  'voronoi',
  // Row 5: New
  'turbulence',
  'ridged fBM',
  'worley F2-F1',
  'posterize',
  'fract repeat',
  'sine grid',
];

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const timer = new Timer();
  const chotto = chottoGL(canvas);
  chotto.fitWindow();

  const shader = chotto.createShader({ fragment: mainFragment });

  const gl = chotto.gl;

  // Enable alpha blending
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // GUI settings
  const settings = {
    colorA: '#1a1a2e',
    alphaA: 1.0,
    colorB: '#eaf4f4',
    alphaB: 1.0,
    animate: true,
    showLabels: true,
  };

  // Parse hex to RGB (0-1)
  function hexToRGB(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  }

  // Parse hex + alpha to RGBA (0-1)
  function hexToRGBA(hex, alpha) {
    const rgb = hexToRGB(hex);
    return [...rgb, alpha];
  }

  // lil-gui setup
  const gui = new GUI({ title: 'Mix Functions' });
  gui.addColor(settings, 'colorA').name('Color A');
  gui.add(settings, 'alphaA', 0, 1, 0.01).name('Alpha A');
  gui.addColor(settings, 'colorB').name('Color B');
  gui.add(settings, 'alphaB', 0, 1, 0.01).name('Alpha B');
  gui.add(settings, 'animate').name('Animate');
  gui.add(settings, 'showLabels').name('Show Labels').onChange(updateLabels);

  // Create labels overlay
  const labelsContainer = document.createElement('div');
  labelsContainer.id = 'labels';
  labelsContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
  `;
  document.body.appendChild(labelsContainer);

  function updateLabels() {
    labelsContainer.innerHTML = '';
    if (!settings.showLabels) return;

    const cols = 6;
    const rows = 5;
    const cellWidth = 100 / cols;
    const cellHeight = 100 / rows;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        if (idx >= FUNCTION_NAMES.length) continue;

        const label = document.createElement('div');
        label.textContent = FUNCTION_NAMES[idx];
        label.style.cssText = `
          position: absolute;
          left: ${col * cellWidth}%;
          top: ${row * cellHeight}%;
          width: ${cellWidth}%;
          padding: 4px 8px;
          font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.9);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
          box-sizing: border-box;
        `;
        labelsContainer.appendChild(label);
      }
    }
  }

  // Initial labels
  updateLabels();

  // Resize handler
  window.addEventListener('resize', updateLabels);

  // Render loop
  const render = () => {
    const time = timer.getElapsedTime();

    chotto.clear(0.1, 0.1, 0.1, 1.0);

    shader.use();
    shader.setUniform('iTime', time);
    shader.setUniform('iResolution', [canvas.width, canvas.height]);
    shader.setUniform('iColorA', hexToRGBA(settings.colorA, settings.alphaA));
    shader.setUniform('iColorB', hexToRGBA(settings.colorB, settings.alphaB));
    shader.setUniform('iAnimate', settings.animate ? 1 : 0);
    shader.setUniform('iShowLabels', settings.showLabels ? 1 : 0);
    shader.draw();

    requestAnimationFrame(render);
  };

  render();
  timer.start();
};
