import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import { isMobile, isTablet } from '../libs/DeviceDetect.js';
import GUI from '../libs/gui.js';

import generateWGSL from './shaders/generate.wgsl?raw';
import raymarchWGSL from './shaders/raymarch.wgsl?raw';
import blitWGSL from './shaders/blit.wgsl?raw';

const GRID_X = 128;
const GRID_Y = 64;
const GRID_Z = 128;
const VOXEL_COUNT = GRID_X * GRID_Y * GRID_Z;
const CORE_LEVEL = 30;
const CAMERA_DISTANCE = 86;
const RENDER_SCALE = isMobile() ? 0.5 : isTablet() ? 0.75 : 1.0;

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;

  const voxelBuffer = chotto.buffer(VOXEL_COUNT * 4, { storage: true });

  const genPipeline = chotto.compute({ shader: generateWGSL });
  const genUBO = chotto.buffer(16, { uniform: true });
  const genData = new Float32Array(4);

  function generateScene(seed) {
    genData[0] = seed;
    genData[1] = CORE_LEVEL;
    genUBO.write(genData);

    const genBG = device.createBindGroup({
      layout: genPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: genUBO.buffer } },
        { binding: 1, resource: { buffer: voxelBuffer.buffer } },
      ],
    });

    chotto.dispatch((p) => {
      p.setPipeline(genPipeline);
      p.setBindGroup(0, genBG);
      p.dispatchWorkgroups(Math.ceil(GRID_X / 8), Math.ceil(GRID_Z / 8), 1);
    });
  }

  const raymarchPipeline = chotto.pipeline({ fragment: raymarchWGSL });

  const scaled = RENDER_SCALE < 1.0;
  let sceneFBO = null;
  let blitPipeline = null;
  let blitBG = null;

  function sceneSize() {
    return {
      width: Math.max(1, Math.round(canvas.width * RENDER_SCALE)),
      height: Math.max(1, Math.round(canvas.height * RENDER_SCALE)),
    };
  }

  function rebuildBlitBG() {
    blitBG = device.createBindGroup({
      layout: blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: chotto.sampler },
        { binding: 1, resource: sceneFBO.view },
      ],
    });
  }

  if (scaled) {
    blitPipeline = chotto.pipeline({ fragment: blitWGSL });
  }

  const UBO_SIZE = 48;
  const uboF32 = new Float32Array(UBO_SIZE / 4);
  const renderUBO = chotto.buffer(UBO_SIZE, { uniform: true });

  const renderBG = device.createBindGroup({
    layout: raymarchPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: renderUBO.buffer } },
      { binding: 1, resource: { buffer: voxelBuffer.buffer } },
    ],
  });

  const params = {
    orbitSpeed: 0.15,
    sunElevation: 0.8,
    fogDensity: 0.006,
    aoStrength: 1.0,
    seed: 42,
  };

  const gui = new GUI({ title: 'Astral Engine Cathedral' });
  gui.add(params, 'orbitSpeed', 0.0, 0.5, 0.01).name('Orbit Speed');
  gui.add(params, 'sunElevation', 0.2, 1.4, 0.01).name('Sun Elevation');
  gui.add(params, 'fogDensity', 0.001, 0.014, 0.001).name('Gas Fade');
  gui.add(params, 'aoStrength', 0.0, 2.0, 0.1).name('AO');
  gui.add({
    regenerate: () => {
      params.seed = Math.floor(Math.random() * 10000);
      generateScene(params.seed);
    },
  }, 'regenerate').name('Regenerate');
  gui.close();

  let isDragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let userYaw = 0;
  let userPitch = 0;

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    userYaw += dx * 0.005;
    userPitch = Math.max(-0.6, Math.min(0.8, userPitch + dy * 0.005));
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  });

  canvas.addEventListener('pointerup', (e) => {
    isDragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointercancel', (e) => {
    isDragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });

  const fpsGraph = new FPSGraph();
  const timer = new Timer();

  chotto.fitWindow(() => {
    if (scaled) {
      const { width, height } = sceneSize();
      sceneFBO.resize(width, height);
      rebuildBlitBG();
    }
  });

  if (scaled) {
    const { width, height } = sceneSize();
    sceneFBO = chotto.framebuffer(width, height);
    rebuildBlitBG();
  }

  generateScene(params.seed);

  const render = () => {
    const time = timer.getElapsedTime();

    const yaw = time * params.orbitSpeed + userYaw;
    const pitch = 0.4 + userPitch;

    const sunAz = time * 0.05;
    const sunEl = params.sunElevation;
    const sunDir = [
      Math.cos(sunEl) * Math.sin(sunAz),
      Math.sin(sunEl),
      Math.cos(sunEl) * Math.cos(sunAz),
    ];

    uboF32[0] = scaled ? sceneFBO.width : canvas.width;
    uboF32[1] = scaled ? sceneFBO.height : canvas.height;
    uboF32[2] = time;
    uboF32[3] = yaw;
    uboF32[4] = pitch;
    uboF32[5] = CAMERA_DISTANCE;
    uboF32[6] = CORE_LEVEL;
    uboF32[7] = params.fogDensity;
    uboF32[8] = sunDir[0];
    uboF32[9] = sunDir[1];
    uboF32[10] = sunDir[2];
    uboF32[11] = params.aoStrength;
    renderUBO.write(uboF32);

    chotto.frame(() => {
      chotto.pass(scaled ? { target: sceneFBO } : {}, (p) => {
        p.setPipeline(raymarchPipeline);
        p.setBindGroup(0, renderBG);
        p.draw(3);
      });

      if (scaled) {
        chotto.pass((p) => {
          p.setPipeline(blitPipeline);
          p.setBindGroup(0, blitBG);
          p.draw(3);
        });
      }
    });

    fpsGraph.update();
    requestAnimationFrame(render);
  };

  render();
  timer.start();
};
