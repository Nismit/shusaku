import { chottoGL } from '../libs/esChottoGL.js';
import { PointerInput } from '../libs/PointerInput.js';
import { Timer } from '../libs/Timer.js';
import GUI from '../libs/lil-gui.esm.min.js';

import commonGLSL from './shaders/common.glsl?raw';
import injectFrag from './shaders/inject.frag?raw';
import buoyancyFrag from './shaders/buoyancy.frag?raw';
import advectFrag from './shaders/advect3d.frag?raw';
import divergenceFrag from './shaders/divergence3d.frag?raw';
import pressureFrag from './shaders/pressure3d.frag?raw';
import gradientFrag from './shaders/gradient3d.frag?raw';
import raymarchFrag from './shaders/raymarch.frag?raw';

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

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const cgl = chottoGL(canvas, {
    extensions: ['EXT_color_buffer_float', 'EXT_color_buffer_half_float'],
  });
  cgl.fitWindow();

  const gl = cgl.gl;

  // Float storage for the volume (RGBA32F, NEAREST so no float-linear needed).
  const canUseFloat32 = !!gl.getExtension('EXT_color_buffer_float');
  const floatFormat = canUseFloat32 ? gl.RGBA32F : gl.RGBA16F;
  const floatType = canUseFloat32 ? gl.FLOAT : gl.HALF_FLOAT;

  // --- Shaders (common helpers prepended to every fragment) ---
  const mk = (frag) => cgl.createShader({ fragment: commonGLSL + '\n' + frag });
  const injectShader = mk(injectFrag);
  const buoyancyShader = mk(buoyancyFrag);
  const advectShader = mk(advectFrag);
  const divergenceShader = mk(divergenceFrag);
  const pressureShader = mk(pressureFrag);
  const gradientShader = mk(gradientFrag);
  const raymarchShader = mk(raymarchFrag);

  // --- Parameters ---
  const config = {
    resolution: 64,
    pressureIterations: 24,
    buoyancy: 14.0,
    velDissipation: 0.2,
    densityDissipation: 0.6,
    emitAmount: 1.2,
    emitForce: 6.0,
    emitRadius: 5.0,
    absorption: 40.0,
    stepCount: 56,
    smokeColor: '#eaf2ff',
    autoRotate: true,
  };

  // --- Volume fields (flat-3D atlas) ---
  let fields = null;

  const buildVolume = (dim) => {
    if (fields) {
      fields.velocity.dispose();
      fields.pressure.dispose();
      fields.density.dispose();
      fields.divergence.dispose();
    }

    const tilesX = Math.ceil(Math.sqrt(dim));
    const tilesY = Math.ceil(dim / tilesX);
    const atlasW = tilesX * dim;
    const atlasH = tilesY * dim;

    const opts = {
      internalFormat: floatFormat,
      format: gl.RGBA,
      type: floatType,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    };

    fields = {
      dim,
      velocity: cgl.createPingPongFramebuffer(atlasW, atlasH, opts),
      pressure: cgl.createPingPongFramebuffer(atlasW, atlasH, opts),
      density: cgl.createPingPongFramebuffer(atlasW, atlasH, opts),
      divergence: cgl.createFramebuffer(atlasW, atlasH, null, opts),
      vol: {
        uVolumeDim: [dim, dim, dim],
        uTiles: [tilesX, tilesY],
        uInvAtlasSize: [1 / atlasW, 1 / atlasH],
      },
    };

    fields.velocity.clear(0, 0, 0, 0);
    fields.pressure.clear(0, 0, 0, 0);
    fields.density.clear(0, 0, 0, 0);
  };

  buildVolume(config.resolution);

  // --- Camera ---
  const camera = { yaw: 0.7, pitch: 0.25, dist: 1.9 };
  const lightDir = [0.4, 0.7, 0.55];
  const lightLen = Math.hypot(...lightDir);
  const lightDirN = lightDir.map((v) => v / lightLen);

  // --- Pointer: drag to orbit ---
  const pointer = new PointerInput(canvas);
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  pointer.onPress((p) => {
    dragging = true;
    lastX = p.normalized.x;
    lastY = p.normalized.y;
  });
  pointer.onRelease(() => { dragging = false; });
  pointer.onMove((p) => {
    if (!dragging) return;
    camera.yaw -= (p.normalized.x - lastX) * 2.2;
    camera.pitch += (p.normalized.y - lastY) * 2.2;
    camera.pitch = Math.max(-1.4, Math.min(1.4, camera.pitch));
    lastX = p.normalized.x;
    lastY = p.normalized.y;
  });

  // --- Simulation step ---
  const step = (dt, time) => {
    const { velocity, pressure, density, divergence, vol, dim } = fields;
    const color = hexToRgb(config.smokeColor);

    // Emitter near the bottom centre, gently swaying.
    const emitter = [
      dim * (0.5 + 0.12 * Math.sin(time * 0.7)),
      dim * 0.16,
      dim * (0.5 + 0.12 * Math.cos(time * 0.9)),
    ];
    const r2 = config.emitRadius * config.emitRadius;

    // Inject smoke (density) and an upward impulse (velocity).
    density.pass(injectShader, {
      ...vol,
      uTarget: density.read,
      uEmitter: emitter,
      uRadius: r2,
      uValue: [
        color[0] * config.emitAmount,
        color[1] * config.emitAmount,
        color[2] * config.emitAmount,
        config.emitAmount,
      ],
    });
    velocity.pass(injectShader, {
      ...vol,
      uTarget: velocity.read,
      uEmitter: emitter,
      uRadius: r2,
      uValue: [0, config.emitForce, 0, 0],
    });

    // Buoyancy.
    velocity.pass(buoyancyShader, {
      ...vol,
      uVelocity: velocity.read,
      uDensity: density.read,
      uBuoyancy: config.buoyancy,
      uDt: dt,
    });

    // Advect velocity.
    velocity.pass(advectShader, {
      ...vol,
      uSource: velocity.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.velDissipation,
    });

    // Divergence.
    divergence.pass(divergenceShader, {
      ...vol,
      uVelocity: velocity.read,
    });

    // Pressure solve (warm-started from previous frame).
    for (let i = 0; i < config.pressureIterations; i++) {
      pressure.pass(pressureShader, {
        ...vol,
        uPressure: pressure.read,
        uDivergence: divergence,
      });
    }

    // Project velocity to be divergence-free.
    velocity.pass(gradientShader, {
      ...vol,
      uPressure: pressure.read,
      uVelocity: velocity.read,
    });

    // Advect density.
    density.pass(advectShader, {
      ...vol,
      uSource: density.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.densityDissipation,
    });
  };

  // --- Raymarch uniforms ---
  const raymarchUniforms = (width, height) => ({
    ...fields.vol,
    iResolution: [width, height],
    uDensity: fields.density.read,
    uCamYaw: camera.yaw,
    uCamPitch: camera.pitch,
    uCamDist: camera.dist,
    uSmokeColor: hexToRgb(config.smokeColor),
    uAbsorption: config.absorption,
    uStepCount: config.stepCount,
    uLightDir: lightDirN,
  });

  // --- GUI ---
  const gui = new GUI({ title: 'Volumetric Smoke' });
  gui.add(config, 'resolution', { '32': 32, '48': 48, '64': 64, '96': 96 })
    .name('Resolution')
    .onChange((v) => buildVolume(parseInt(v, 10)));
  gui.add(config, 'pressureIterations', 1, 60, 1).name('Pressure Iter');
  gui.add(config, 'buoyancy', 0, 40, 0.5).name('Buoyancy');
  gui.add(config, 'densityDissipation', 0, 3, 0.05).name('Smoke Fade');
  gui.add(config, 'velDissipation', 0, 2, 0.05).name('Vel Fade');
  gui.add(config, 'emitAmount', 0, 4, 0.1).name('Emit Amount');
  gui.add(config, 'emitForce', 0, 30, 0.5).name('Emit Force');
  gui.add(config, 'absorption', 5, 120, 1).name('Absorption');
  gui.add(config, 'stepCount', 16, 128, 1).name('Ray Steps');
  gui.addColor(config, 'smokeColor').name('Smoke Color');
  gui.add(config, 'autoRotate').name('Auto Rotate');
  gui.close();

  // --- Controls (play / pause / reset / snapshot) ---
  let isPlaying = true;
  let frameCount = 0;
  const timer = new Timer();

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

  const getSelectedPreset = () => {
    const value = sizePresetSelect ? sizePresetSelect.value : '1080p';
    if (value === 'Custom') {
      return {
        width: parseInt(customWidth?.value, 10) || 1920,
        height: parseInt(customHeight?.value, 10) || 1080,
      };
    }
    return SIZE_PRESETS[value] || SIZE_PRESETS['1080p'];
  };

  const updatePlayPauseLabel = () => {
    if (playPauseBtn) playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
  };

  const togglePlayPause = () => {
    isPlaying = !isPlaying;
    isPlaying ? timer.start() : timer.stop();
    updatePlayPauseLabel();
  };

  const resetSim = () => {
    buildVolume(fields.dim);
    timer.reset();
    timer.start();
    isPlaying = true;
    frameCount = 0;
    updatePlayPauseLabel();
  };

  const captureSnapshot = async () => {
    const { width, height } = getSelectedPreset();
    const tempFBO = cgl.createFramebuffer(width, height);
    tempFBO.pass(raymarchShader, raymarchUniforms(width, height));
    const pixels = readPixelsFromFBO(tempFBO, gl);
    const blob = await pixelsToBlob(pixels, width, height);
    downloadBlob(blob, `volumetric_smoke_${Date.now()}.png`);
    tempFBO.dispose();
  };

  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
  if (resetBtn) resetBtn.addEventListener('click', resetSim);
  if (snapshotBtn) snapshotBtn.addEventListener('click', captureSnapshot);

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
    if (e.code === 'KeyR') { resetSim(); }
    if (e.code === 'KeyS') { captureSnapshot(); }
  });

  // --- Render loop ---
  let lastTime = performance.now();
  timer.start();

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    pointer.update();

    if (isPlaying) {
      if (config.autoRotate && !dragging) camera.yaw += dt * 0.25;
      // Fixed sub-step keeps the solver stable regardless of frame rate.
      step(Math.min(dt, 1 / 60), timer.getElapsedTime());
      frameCount++;
    }

    cgl.pass(raymarchShader, raymarchUniforms(canvas.width, canvas.height));

    if (timeDisplay) {
      timeDisplay.textContent = `${timer.getElapsedTime().toFixed(2)}s | f:${frameCount} | ${fields.dim}³`;
    }

    requestAnimationFrame(render);
  };

  render();
};
