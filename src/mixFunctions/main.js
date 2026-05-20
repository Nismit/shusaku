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
  // Row 6: Waves + Noise
  'square wave',
  'triangle wave',
  'sawtooth',
  'pulse',
  'worley F1',
  'curl noise',
  // Row 7: Noise + Polar
  'caustics',
  'smooth voronoi',
  'spiral',
  'rose curve',
  'lissajous',
  'polar fBM',
];

const COLS = 6;
const ROWS = 7;
const BASE_CELL_SIZE = 400;
const BASE_GAP = 24;
const MAX_GAP = 60; // ~2.5x base, subtle expansion

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

  const settings = {
    colorA: '#1a1a2e',
    alphaA: 1.0,
    colorB: '#eaf4f4',
    alphaB: 1.0,
    animate: true,
    showLabels: true,
    zoom: 0.45,
  };

  // Gap animation state (0 = normal, 1 = expanded)
  let gapAnimT = 0.0;
  let isPressed = false;

  const getCellSize = () => Math.round(BASE_CELL_SIZE * settings.zoom);
  const getCurrentGap = () => (BASE_GAP + (MAX_GAP - BASE_GAP) * gapAnimT) * settings.zoom;
  const getStride = () => getCellSize() + getCurrentGap();

  // Pan offset (world pixels at screen top-left)
  const offset = { x: 0, y: 0 };

  // Keep screen center fixed when stride changes (zoom or gap animation)
  let lastStride = getStride();
  function adjustOffset(oldStride, newStride) {
    if (Math.abs(newStride - oldStride) < 0.001) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    offset.x = (cx + offset.x) / oldStride * newStride - cx;
    offset.y = (cy + offset.y) / oldStride * newStride - cy;
  }

  // ---- Input handling ----

  let isDragging = false;
  let dragLast = { x: 0, y: 0 };

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    isPressed = true;
    dragLast = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    offset.x -= e.clientX - dragLast.x;
    offset.y -= e.clientY - dragLast.y;
    dragLast = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    isPressed = false;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    offset.x += e.deltaX;
    offset.y += e.deltaY;
  }, { passive: false });

  let lastTouch = null;
  canvas.addEventListener('touchstart', (e) => {
    isPressed = true;
    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    offset.x -= e.touches[0].clientX - lastTouch.x;
    offset.y -= e.touches[0].clientY - lastTouch.y;
    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    isPressed = false;
    lastTouch = null;
  });

  // ---- Labels overlay ----

  const labelsContainer = document.createElement('div');
  labelsContainer.id = 'labels';
  labelsContainer.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 10;
  `;
  document.body.appendChild(labelsContainer);

  // Dirty-check to avoid unnecessary DOM rebuilds
  let prevLabelKey = '';
  function updateLabels() {
    const stride = getStride();
    const key = `${stride.toFixed(2)},${offset.x.toFixed(2)},${offset.y.toFixed(2)},${settings.showLabels}`;
    if (key === prevLabelKey) return;
    prevLabelKey = key;

    labelsContainer.innerHTML = '';
    if (!settings.showLabels) return;

    const cellSize = getCellSize();
    const fontSize = Math.max(9, Math.round(13 * settings.zoom));

    const minCol = Math.floor(offset.x / stride) - 1;
    const maxCol = Math.ceil((offset.x + canvas.width) / stride);
    const minRow = Math.floor(offset.y / stride) - 1;
    const maxRow = Math.ceil((offset.y + canvas.height) / stride);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const screenX = col * stride - offset.x;
        const screenY = row * stride - offset.y;

        if (screenX + cellSize < 0 || screenX > canvas.width) continue;
        if (screenY + cellSize < 0 || screenY > canvas.height) continue;

        const wrappedCol = ((col % COLS) + COLS) % COLS;
        const wrappedRow = ((row % ROWS) + ROWS) % ROWS;
        const funcId = wrappedRow * COLS + wrappedCol;

        const label = document.createElement('div');
        label.textContent = FUNCTION_NAMES[funcId];
        label.style.cssText = `
          position: absolute;
          left: ${screenX}px;
          top: ${screenY}px;
          width: ${cellSize}px;
          padding: 4px 8px;
          font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
          font-size: ${fontSize}px;
          color: rgba(255, 255, 255, 0.9);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
          box-sizing: border-box;
        `;
        labelsContainer.appendChild(label);
      }
    }
  }

  // ---- GUI ----

  const gui = new GUI({ title: 'Mix Functions' });
  gui.addColor(settings, 'colorA').name('Color A');
  gui.add(settings, 'alphaA', 0, 1, 0.01).name('Alpha A');
  gui.addColor(settings, 'colorB').name('Color B');
  gui.add(settings, 'alphaB', 0, 1, 0.01).name('Alpha B');
  gui.add(settings, 'animate').name('Animate');
  gui.add(settings, 'showLabels').name('Show Labels').onChange(() => {
    prevLabelKey = ''; // force rebuild
  });
  gui.add(settings, 'zoom', 0.1, 2.0, 0.05).name('Zoom').onChange(() => {
    const newStride = getStride();
    adjustOffset(lastStride, newStride);
    lastStride = newStride;
    prevLabelKey = '';
  });

  window.addEventListener('resize', () => { prevLabelKey = ''; });

  // ---- Render loop ----

  const render = () => {
    const time = timer.getElapsedTime();

    // Animate gap: faster to expand, slightly slower to contract
    const target = isPressed ? 1.0 : 0.0;
    gapAnimT += (target - gapAnimT) * (isPressed ? 0.1 : 0.07);

    // Adjust offset to keep screen center fixed during gap animation
    const newStride = getStride();
    adjustOffset(lastStride, newStride);
    lastStride = newStride;

    // Update labels (dirty-checked inside)
    updateLabels();

    chotto.clear(0.1, 0.1, 0.1, 1.0);

    shader.use();
    shader.setUniform('iTime', time);
    shader.setUniform('iResolution', [canvas.width, canvas.height]);
    shader.setUniform('iOffset', [offset.x, offset.y]);
    shader.setUniform('iCellSize', getCellSize());
    shader.setUniform('iStride', getStride());
    shader.setUniform('iColorA', hexToRGBA(settings.colorA, settings.alphaA));
    shader.setUniform('iColorB', hexToRGBA(settings.colorB, settings.alphaB));
    shader.setUniform('iAnimate', settings.animate ? 1 : 0);
    shader.setUniform('iShowLabels', settings.showLabels ? 1 : 0);
    shader.draw();

    requestAnimationFrame(render);
  };

  updateLabels();
  render();
  timer.start();
};

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, alpha];
}
