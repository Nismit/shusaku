import { chottoGL } from '../libs/esChottoGL.js';
import { Timer } from '../libs/Timer.js';
import GUI from '../libs/lil-gui.esm.min.js';

import mainFragment from './shaders/main.frag?raw';

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

const COLS = 6;
const ROWS = 5;

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const timer = new Timer();
  const chotto = chottoGL(canvas);
  chotto.fitWindow();

  const shader = chotto.createShader({ fragment: mainFragment });
  const gl = chotto.gl;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Square cell size: fit all functions in the initial viewport
  const cellSize = Math.floor(Math.min(canvas.width / COLS, canvas.height / ROWS));

  // Pan offset: start with grid centered in viewport
  const offset = {
    x: (COLS * cellSize - canvas.width) / 2,
    y: (ROWS * cellSize - canvas.height) / 2,
  };

  // Drag state
  let isDragging = false;
  let dragLast = { x: 0, y: 0 };

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragLast = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    offset.x -= e.clientX - dragLast.x;
    offset.y -= e.clientY - dragLast.y;
    dragLast = { x: e.clientX, y: e.clientY };
    updateLabels();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    canvas.classList.remove('dragging');
  });

  // Wheel scroll (horizontal + vertical)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    offset.x += e.deltaX;
    offset.y += e.deltaY;
    updateLabels();
  }, { passive: false });

  // Touch panning
  let lastTouch = null;
  canvas.addEventListener('touchstart', (e) => {
    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const dx = e.touches[0].clientX - lastTouch.x;
    const dy = e.touches[0].clientY - lastTouch.y;
    offset.x -= dx;
    offset.y -= dy;
    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    updateLabels();
  }, { passive: false });

  canvas.addEventListener('touchend', () => { lastTouch = null; });

  // GUI settings
  const settings = {
    colorA: '#1a1a2e',
    alphaA: 1.0,
    colorB: '#eaf4f4',
    alphaB: 1.0,
    animate: true,
    showLabels: true,
  };

  function hexToRGBA(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b, alpha];
  }

  const gui = new GUI({ title: 'Mix Functions' });
  gui.addColor(settings, 'colorA').name('Color A');
  gui.add(settings, 'alphaA', 0, 1, 0.01).name('Alpha A');
  gui.addColor(settings, 'colorB').name('Color B');
  gui.add(settings, 'alphaB', 0, 1, 0.01).name('Alpha B');
  gui.add(settings, 'animate').name('Animate');
  gui.add(settings, 'showLabels').name('Show Labels').onChange(updateLabels);

  // Labels overlay
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

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        if (idx >= FUNCTION_NAMES.length) continue;

        // World-to-screen: subtract the scroll offset
        const screenX = col * cellSize - offset.x;
        const screenY = row * cellSize - offset.y;

        // Skip cells outside the viewport
        if (screenX + cellSize < 0 || screenX > canvas.width) continue;
        if (screenY + cellSize < 0 || screenY > canvas.height) continue;

        const label = document.createElement('div');
        label.textContent = FUNCTION_NAMES[idx];
        label.style.cssText = `
          position: absolute;
          left: ${screenX}px;
          top: ${screenY}px;
          width: ${cellSize}px;
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

  updateLabels();

  window.addEventListener('resize', updateLabels);

  // Render loop
  const render = () => {
    const time = timer.getElapsedTime();

    chotto.clear(0.1, 0.1, 0.1, 1.0);

    shader.use();
    shader.setUniform('iTime', time);
    shader.setUniform('iResolution', [canvas.width, canvas.height]);
    shader.setUniform('iOffset', [offset.x, offset.y]);
    shader.setUniform('iCellSize', cellSize);
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
