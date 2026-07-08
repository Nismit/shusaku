import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import { isMobile, isTablet } from '../libs/DeviceDetect.js';
import GUI from '../libs/gui.js';

import tunnelWGSL from './shaders/tunnel.wgsl?raw';
import blitWGSL from './shaders/blit.wgsl?raw';

// The raymarch cost scales with pixel count (O(steps * pixels)), so cutting
// step count alone still leaves phones shading every physical pixel at up to
// 2x DPR. Rendering the raymarch at reduced resolution and upscaling to the
// canvas cuts that pixel count directly, which is the far bigger lever.
const RENDER_SCALE = isMobile() ? 0.6 : isTablet() ? 0.85 : 1.0;

// Looking straight down the tunnel's central axis needs many march steps and
// a long ray distance to ever curve into a wall - with a short MAX_DIST/step
// budget those center rays exhaust their budget before converging and fall
// into the "miss" (near-black) branch, showing up as a dark disc in the
// middle of the screen. RENDER_SCALE above already cuts mobile's per-frame
// cost to well under what the old 40-step/full-resolution budget cost, so
// there's headroom to raise steps/distance back up without regressing perf.
const MAX_STEPS = isMobile() ? 64 : isTablet() ? 72 : 96;
const STEP_SCALE = isMobile() ? 0.85 : 0.8;
const MAX_DIST = isMobile() ? 110.0 : 120.0;

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;

  const tunnelPipeline = chotto.pipeline({ fragment: tunnelWGSL });

  const scaled = RENDER_SCALE < 1.0;
  let sceneFBO = null;
  let blitPipeline = null;
  let blitBindGroup = null;

  function sceneSize() {
    return {
      width: Math.max(1, Math.round(canvas.width * RENDER_SCALE)),
      height: Math.max(1, Math.round(canvas.height * RENDER_SCALE)),
    };
  }

  function rebuildBlitBindGroup() {
    blitBindGroup = device.createBindGroup({
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

  const UBO_SIZE = 64;
  const uboAB = new ArrayBuffer(UBO_SIZE);
  const uboF32 = new Float32Array(uboAB);
  const uboI32 = new Int32Array(uboAB);
  const ubo = chotto.buffer(UBO_SIZE, { uniform: true });

  const params = {
    speed: 1.0,
    freqA: 0.15,
    freqB: 0.25,
    ampA: 2.4,
    ampB: 1.7,
    tunnelRadius: 1.0,
  };

  const gui = new GUI({ title: 'Tunnel Raymarching' });
  gui.add(params, 'speed', 0.1, 3.0, 0.1).name('Speed');

  const pathFolder = gui.addFolder('Path');
  pathFolder.add(params, 'freqA', 0.05, 0.5, 0.01).name('Freq A');
  pathFolder.add(params, 'freqB', 0.05, 0.5, 0.01).name('Freq B');
  pathFolder.add(params, 'ampA', 0.5, 5.0, 0.1).name('Amp A');
  pathFolder.add(params, 'ampB', 0.5, 5.0, 0.1).name('Amp B');
  pathFolder.add(params, 'tunnelRadius', 0.5, 2.0, 0.1).name('Radius');
  pathFolder.close();

  gui.close();

  const fpsGraph = new FPSGraph();
  const timer = new Timer();
  let isPlaying = true;
  let frameCount = 0;

  let boostTarget = 0.0;
  let boostProgress = 0.0;
  let boostValue = 0.0;
  let boostTime = 0.0;
  let lastTime = 0.0;
  const boostRampUp = 0.012;
  const boostRampDown = 0.008;

  canvas.addEventListener('mousedown', () => { boostTarget = 1.0; });
  canvas.addEventListener('mouseup', () => { boostTarget = 0.0; });
  canvas.addEventListener('mouseleave', () => { boostTarget = 0.0; });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); boostTarget = 1.0; }, { passive: false });
  canvas.addEventListener('touchend', () => { boostTarget = 0.0; });
  canvas.addEventListener('touchcancel', () => { boostTarget = 0.0; });

  function togglePlayPause() {
    if (isPlaying) { timer.stop(); isPlaying = false; }
    else { timer.start(); isPlaying = true; }
  }

  function resetTimer() {
    timer.reset();
    timer.start();
    isPlaying = true;
    frameCount = 0;
  }

  async function captureSnapshot() {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tunnel_raymarching_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
    if (e.code === 'KeyR') { resetTimer(); }
    if (e.code === 'KeyS') { captureSnapshot(); }
  });

  chotto.fitWindow(() => {
    if (scaled) {
      const { width, height } = sceneSize();
      sceneFBO.resize(width, height);
      rebuildBlitBindGroup();
    }
  });

  if (scaled) {
    const { width, height } = sceneSize();
    sceneFBO = chotto.framebuffer(width, height);
    rebuildBlitBindGroup();
  }

  const tunnelBindGroup = device.createBindGroup({
    layout: tunnelPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ubo.buffer } }],
  });

  const render = () => {
    const time = timer.getElapsedTime();

    if (boostTarget > 0.0) {
      boostProgress = Math.min(1.0, boostProgress + boostRampUp);
    } else {
      boostProgress = Math.max(0.0, boostProgress - boostRampDown);
    }
    boostValue = boostProgress * boostProgress * (3.0 - 2.0 * boostProgress);

    const dt = time - lastTime;
    lastTime = time;
    boostTime += dt * boostValue;

    uboF32[0] = scaled ? sceneFBO.width : canvas.width;
    uboF32[1] = scaled ? sceneFBO.height : canvas.height;
    uboF32[2] = time;
    uboF32[3] = params.speed;
    uboF32[4] = boostTime;
    uboF32[5] = params.freqA;
    uboF32[6] = params.freqB;
    uboF32[7] = params.ampA;
    uboF32[8] = params.ampB;
    uboF32[9] = params.tunnelRadius;
    uboI32[10] = MAX_STEPS;
    uboF32[11] = STEP_SCALE;
    uboF32[12] = MAX_DIST;
    ubo.write(uboF32);

    chotto.frame(() => {
      chotto.pass(scaled ? { target: sceneFBO } : {}, (p) => {
        p.setPipeline(tunnelPipeline);
        p.setBindGroup(0, tunnelBindGroup);
        p.draw(3);
      });

      if (scaled) {
        chotto.pass((p) => {
          p.setPipeline(blitPipeline);
          p.setBindGroup(0, blitBindGroup);
          p.draw(3);
        });
      }
    });

    fpsGraph.update();
    if (isPlaying) frameCount++;
    requestAnimationFrame(render);
  };

  render();
  timer.start();
};
