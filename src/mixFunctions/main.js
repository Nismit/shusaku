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
const BASE_CELL_SIZE = 400; // px at zoom=1
const BASE_STRIDE = 424;    // cell + gap at zoom=1

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

  const getCellSize = () => Math.round(BASE_CELL_SIZE * settings.zoom);
  const getStride   = () => Math.round(BASE_STRIDE   * settings.zoom);

  // Pan offset (world pixels at screen origin)
  const offset = { x: 0, y: 0 };

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

  // Wheel scroll
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

    const cellSize = getCellSize();
    const stride   = getStride();
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

  // GUI
  const gui = new GUI({ title: 'Mix Functions' });
  gui.addColor(settings, 'colorA').name('Color A');
  gui.add(settings, 'alphaA', 0, 1, 0.01).name('Alpha A');
  gui.addColor(settings, 'colorB').name('Color B');
  gui.add(settings, 'alphaB', 0, 1, 0.01).name('Alpha B');
  gui.add(settings, 'animate').name('Animate');
  gui.add(settings, 'showLabels').name('Show Labels').onChange(updateLabels);

  // Zoom: scale toward screen center
  let prevStride = getStride();
  gui.add(settings, 'zoom', 0.1, 2.0, 0.05).name('Zoom').onChange(() => {
    const newStride = getStride();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    offset.x = (cx + offset.x) / prevStride * newStride - cx;
    offset.y = (cy + offset.y) / prevStride * newStride - cy;
    prevStride = newStride;
    updateLabels();
  });

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
    shader.setUniform('iCellSize', getCellSize());
    shader.setUniform('iStride', getStride());
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

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, alpha];
}
