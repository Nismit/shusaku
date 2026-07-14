import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import { createLoadingProgress, tuneGPUPerformance } from '../libs/GPUPerformanceTuner.js';

import contourWGSL from './shaders/contour.wgsl?raw';
import blitWGSL from './shaders/blit.wgsl?raw';

export const main = async () => {
  const loading = createLoadingProgress();
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;
  loading.update(0.03, 'Preparing graphics');

  const pipeline = chotto.pipeline({ fragment: contourWGSL });
  const blitPipeline = chotto.pipeline({ fragment: blitWGSL });

  let renderScale = 1.0;
  let maxSteps = 80;
  let maxDist = 30.0;
  let sceneFBO = null;
  let blitBindGroup = null;

  function sceneSize() {
    return {
      width: Math.max(1, Math.round(canvas.width * renderScale)),
      height: Math.max(1, Math.round(canvas.height * renderScale)),
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

  const UBO_SIZE = 24;
  const uboAB = new ArrayBuffer(UBO_SIZE);
  const uboF32 = new Float32Array(uboAB);
  const uboI32 = new Int32Array(uboAB);
  const ubo = chotto.buffer(UBO_SIZE, { uniform: true });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ubo.buffer } }],
  });

  chotto.fitWindow(() => {
    if (sceneFBO) {
      const { width, height } = sceneSize();
      sceneFBO.resize(width, height);
      rebuildBlitBindGroup();
    }
  });

  const { width, height } = sceneSize();
  sceneFBO = chotto.framebuffer(width, height);
  rebuildBlitBindGroup();

  const fpsGraph = new FPSGraph();
  const timer = new Timer();

  let benchmarking = true;
  const render = () => {
    const time = timer.getElapsedTime();
    const scaled = renderScale < 0.999;

    uboF32[0] = scaled ? sceneFBO.width : canvas.width;
    uboF32[1] = scaled ? sceneFBO.height : canvas.height;
    uboF32[2] = time;
    uboF32[3] = maxDist;
    uboI32[4] = maxSteps;
    ubo.write(uboF32);

    chotto.frame(() => {
      chotto.pass(scaled ? { target: sceneFBO } : {}, (p) => {
        p.setPipeline(pipeline);
        p.setBindGroup(0, bindGroup);
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

    if (!benchmarking) {
      fpsGraph.update();
      requestAnimationFrame(render);
    }
  };

  const qualityProfiles = [
    { name: 'High', renderScale: 1.0, maxSteps: 80, maxDist: 30.0 },
    { name: 'Balanced', renderScale: 0.85, maxSteps: 64, maxDist: 26.0 },
    { name: 'Medium', renderScale: 0.7, maxSteps: 56, maxDist: 22.0 },
    { name: 'Low', renderScale: 0.55, maxSteps: 44, maxDist: 18.0 },
  ];

  timer.start();
  const tuning = await tuneGPUPerformance({
    device,
    profiles: qualityProfiles,
    applyProfile: (profile) => {
      renderScale = profile.renderScale;
      maxSteps = profile.maxSteps;
      maxDist = profile.maxDist;
      const size = sceneSize();
      sceneFBO.resize(size.width, size.height);
      rebuildBlitBindGroup();
    },
    renderFrame: render,
    targetFPS: 60,
    onProgress: (progress, profile, phase) => {
      const suffix = phase === 'complete' ? profile.name : `Testing ${profile.name}`;
      loading.update(0.05 + progress * 0.95, suffix);
    },
  });

  console.info('[GPU tuner]', tuning.profile.name, tuning.results.map(({ profile, fps }) => ({
    profile: profile.name,
    fps: Math.round(fps),
  })));
  benchmarking = false;
  timer.reset();
  timer.start();
  await loading.finish();
  render();
};
