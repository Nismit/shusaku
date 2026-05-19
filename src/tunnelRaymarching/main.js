import { chottoGL } from '../libs/esChottoGL.js';
import { Timer } from '../libs/Timer.js';
import GUI from '../libs/lil-gui.esm.min.js';

import tunnelFrag from './shaders/tunnel.frag?raw';

const SIZE_PRESETS = {
  '1080p': { width: 1920, height: 1080 },
  '4K': { width: 3840, height: 2160 },
  'Square 1080': { width: 1080, height: 1080 },
  'Instagram': { width: 1080, height: 1350 },
};

function readPixelsFromFBO(fbo, gl) {
  fbo.bind();
  const pixels = new Uint8Array(fbo.width * fbo.height * 4);
  gl.readPixels(0, 0, fbo.width, fbo.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  fbo.unbind();
  return pixels;
}

function pixelsToBlob(pixels, w, h) {
  return new Promise((resolve) => {
    const flipped = new Uint8Array(w * h * 4);
    const rowSize = w * 4;
    for (let y = 0; y < h; y++) {
      const srcOffset = y * rowSize;
      const dstOffset = (h - 1 - y) * rowSize;
      flipped.set(pixels.subarray(srcOffset, srcOffset + rowSize), dstOffset);
    }
    const osc = new OffscreenCanvas(w, h);
    const ctx = osc.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(flipped.buffer), w, h);
    ctx.putImageData(imageData, 0, 0);
    osc.convertToBlob({ type: 'image/png' }).then(resolve);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const timer = new Timer();
  const chotto = chottoGL(canvas);
  chotto.fitWindow();

  const gl = chotto.gl;

  // --- Shader ---
  const shader = chotto.createShader({ fragment: tunnelFrag });

  // --- FBO for snapshot ---
  const sceneFBO = chotto.createFramebuffer(canvas.width, canvas.height);

  window.addEventListener('resize', () => {
    sceneFBO.resize(canvas.width, canvas.height);
  });

  // --- GUI ---
  const params = {
    speed: 1.0,
    freqA: 0.15,
    freqB: 0.25,
    ampA: 2.4,
    ampB: 1.7,
    tunnelRadius: 1.0,
    style: 0,
  };

  const gui = new GUI({ title: 'Tunnel Raymarching' });
  gui.add(params, 'speed', 0.1, 3.0, 0.1).name('Speed');
  gui.add(params, 'style', {
    'Wireframe': 0,
    'Neon': 1,
    'Tech': 2,
    'Organic': 3,
    'Warp': 4,
  }).name('Style');

  const pathFolder = gui.addFolder('Path');
  pathFolder.add(params, 'freqA', 0.05, 0.5, 0.01).name('Freq A');
  pathFolder.add(params, 'freqB', 0.05, 0.5, 0.01).name('Freq B');
  pathFolder.add(params, 'ampA', 0.5, 5.0, 0.1).name('Amp A');
  pathFolder.add(params, 'ampB', 0.5, 5.0, 0.1).name('Amp B');
  pathFolder.add(params, 'tunnelRadius', 0.5, 2.0, 0.1).name('Radius');
  pathFolder.close();

  gui.close();

  // --- Timer controls ---
  let isPlaying = true;
  let frameCount = 0;

  const playPauseBtn = document.getElementById('play-pause');
  const resetBtn = document.getElementById('reset');
  const timeDisplay = document.getElementById('time-display');
  const snapshotBtn = document.getElementById('snapshot');
  const sizePresetSelect = document.getElementById('size-preset');
  const customSizeInputs = document.getElementById('custom-size');
  const customWidth = document.getElementById('custom-width');
  const customHeight = document.getElementById('custom-height');

  if (sizePresetSelect) {
    sizePresetSelect.addEventListener('change', () => {
      if (customSizeInputs) {
        customSizeInputs.style.display = sizePresetSelect.value === 'Custom' ? 'inline' : 'none';
      }
    });
  }

  function getSelectedPreset() {
    const value = sizePresetSelect ? sizePresetSelect.value : '1080p';
    if (value === 'Custom') {
      return {
        width: parseInt(customWidth?.value, 10) || 1920,
        height: parseInt(customHeight?.value, 10) || 1080,
      };
    }
    return SIZE_PRESETS[value] || SIZE_PRESETS['1080p'];
  }

  function updatePlayPauseLabel() {
    if (playPauseBtn) playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
  }

  function togglePlayPause() {
    if (isPlaying) {
      timer.stop();
      isPlaying = false;
    } else {
      timer.start();
      isPlaying = true;
    }
    updatePlayPauseLabel();
  }

  function resetTimer() {
    timer.reset();
    timer.start();
    isPlaying = true;
    frameCount = 0;
    updatePlayPauseLabel();
  }

  function renderToFBO(fbo, time) {
    fbo.pass(shader, {
      iTime: time,
      iResolution: [fbo.width, fbo.height],
      iSpeed: params.speed,
      iFreqA: params.freqA,
      iFreqB: params.freqB,
      iAmpA: params.ampA,
      iAmpB: params.ampB,
      iTunnelRadius: params.tunnelRadius,
      iStyle: params.style,
    });
  }

  async function captureSnapshot() {
    const { width, height } = getSelectedPreset();
    const tempFBO = chotto.createFramebuffer(width, height);

    const time = timer.getElapsedTime();
    renderToFBO(tempFBO, time);

    const pixels = readPixelsFromFBO(tempFBO, gl);
    const blob = await pixelsToBlob(pixels, width, height);
    const timestamp = Date.now();
    downloadBlob(blob, `tunnel_raymarching_${timestamp}.png`);

    tempFBO.dispose();
  }

  // --- Event listeners ---
  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
  if (resetBtn) resetBtn.addEventListener('click', resetTimer);
  if (snapshotBtn) snapshotBtn.addEventListener('click', captureSnapshot);

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
    if (e.code === 'KeyR') { resetTimer(); }
    if (e.code === 'KeyS') { captureSnapshot(); }
  });

  // --- Render loop ---
  const render = () => {
    const time = timer.getElapsedTime();

    shader.use();
    shader.setUniform('iTime', time);
    shader.setUniform('iResolution', [canvas.width, canvas.height]);
    shader.setUniform('iSpeed', params.speed);
    shader.setUniform('iFreqA', params.freqA);
    shader.setUniform('iFreqB', params.freqB);
    shader.setUniform('iAmpA', params.ampA);
    shader.setUniform('iAmpB', params.ampB);
    shader.setUniform('iTunnelRadius', params.tunnelRadius);
    shader.setUniform('iStyle', params.style);
    shader.draw();

    if (isPlaying) frameCount++;

    if (timeDisplay) {
      timeDisplay.textContent = `${time.toFixed(2)}s | f:${frameCount}`;
    }

    requestAnimationFrame(render);
  };

  render();
  timer.start();
};
