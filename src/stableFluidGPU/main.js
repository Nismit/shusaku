import { chottoGPU } from 'chottogpu';
import { PointerInput } from '../libs/PointerInput.js';
import GUI from '../libs/gui.js';

import splatWGSL from './shaders/splat.wgsl?raw';
import advectionWGSL from './shaders/advection.wgsl?raw';
import divergenceWGSL from './shaders/divergence.wgsl?raw';
import pressureWGSL from './shaders/pressure.wgsl?raw';
import gradientWGSL from './shaders/gradient.wgsl?raw';
import blurWGSL from './shaders/blur.wgsl?raw';
import displayWGSL from './shaders/display.wgsl?raw';

// フィールドは符号付き浮動小数を格納する。rgba16float は WebGPU で
// リニアフィルタリング可能なので、追加の feature なしで速度/圧力/染料を扱える。
const FIELD_FORMAT = 'rgba16float';

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resizeCanvas = () => {
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;

  // --- Parameters ---
  const config = {
    simResolution: 512,
    dyeResolution: 512,
    dyeDissipation: 3.5,
    pressureIterations: 20,
    splatSize: 15,
    splatForce: 50,
    colorful: true,
    color: '#00bcd4',
    dotMatrix: true,
    dotCell: 10,
    dotScale: 0.9,
  };

  const hexToRgb = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  };

  // --- Pipelines (fullscreen fragment passes) ---
  const splatPipeline = chotto.pipeline({ fragment: splatWGSL, format: FIELD_FORMAT });
  const advectionPipeline = chotto.pipeline({ fragment: advectionWGSL, format: FIELD_FORMAT });
  const divergencePipeline = chotto.pipeline({ fragment: divergenceWGSL, format: FIELD_FORMAT });
  const pressurePipeline = chotto.pipeline({ fragment: pressureWGSL, format: FIELD_FORMAT });
  const gradientPipeline = chotto.pipeline({ fragment: gradientWGSL, format: FIELD_FORMAT });
  const blurPipeline = chotto.pipeline({ fragment: blurWGSL, format: FIELD_FORMAT });
  const displayPipeline = chotto.pipeline({ fragment: displayWGSL }); // → canvas format

  // --- Framebuffers ---
  const createFBO = (w, h) => chotto.framebuffer(w, h, { format: FIELD_FORMAT });
  const createDoubleFBO = (w, h) => ({
    read: createFBO(w, h),
    write: createFBO(w, h),
    swap() { const t = this.read; this.read = this.write; this.write = t; },
  });

  const simSize = { w: config.simResolution, h: config.simResolution };
  const dyeSize = { w: config.dyeResolution, h: config.dyeResolution };

  const velocity = createDoubleFBO(simSize.w, simSize.h);
  const pressure = createDoubleFBO(simSize.w, simSize.h);
  const divergence = createFBO(simSize.w, simSize.h);
  const dye = createDoubleFBO(dyeSize.w, dyeSize.h);

  // --- Uniform buffers ---
  // frame() 内では queue.writeBuffer が GPU 実行前にすべて解決されるため、
  // 1 フレーム内でデータが異なるパスには専用 UBO を割り当てる (last-write-wins 回避)。
  const makeUBO = (bytes) => ({ ubo: chotto.buffer(bytes, { uniform: true }), data: new Float32Array(bytes / 4) });

  const splatVel = makeUBO(32);   // Params: point vec2 + radius + aspect + color vec3 + pad
  const splatDye = makeUBO(32);
  const advVel = makeUBO(16);     // Params: texelSize vec2 + dt + dissipation
  const advDye = makeUBO(16);
  const blurH = makeUBO(16);      // Params: texelSize vec2 + direction vec2
  const blurV = makeUBO(16);
  const divUBO = makeUBO(16);     // Params: texelSize vec2 (+ pad)
  const pressureUBO = makeUBO(16);
  const gradUBO = makeUBO(16);
  const displayUBO = makeUBO(32); // Params: resolution vec2 + cellSize + dotScale + enabled + pad

  // --- Bind group helpers ---
  const bind = (pipeline, entries) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const smp = (binding) => ({ binding, resource: chotto.sampler });
  const tex = (binding, fbo) => ({ binding, resource: fbo.view });
  const buf = (binding, u) => ({ binding, resource: { buffer: u.ubo.buffer } });

  // 全画面パスを対象 FBO (省略時は canvas) へ描画
  const fullscreen = (pipeline, target, entries) => {
    chotto.pass(target ? { target } : {}, (p) => {
      p.setPipeline(pipeline);
      p.setBindGroup(0, bind(pipeline, entries));
      p.draw(3);
    });
  };

  // --- Pointer input (mouse + touch) ---
  const pointer = new PointerInput(canvas);
  const smoothedVelocity = { x: 0, y: 0 };
  const smoothing = 0.2;
  const decay = 0.85;

  pointer.onMove(() => {
    const rawVel = pointer.getNormalizedVelocity();
    smoothedVelocity.x += (rawVel.x * 0.5 - smoothedVelocity.x) * smoothing;
    smoothedVelocity.y += (rawVel.y * 0.5 - smoothedVelocity.y) * smoothing;
  });

  // --- Random color ---
  const randomColor = () => {
    const hue = Math.random() * 360;
    const s = 0.7, l = 0.5;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [(r + m), (g + m), (b + m)];
  };

  let currentColor = hexToRgb(config.color);
  let colorTimer = 0;

  // --- Splat (velocity + dye) ---
  const splat = (x, y, dx, dy, color) => {
    const aspect = canvas.width / canvas.height;
    const radius = config.splatSize * 0.0002;

    // Velocity splat
    splatVel.data[0] = x; splatVel.data[1] = y;
    splatVel.data[2] = radius; splatVel.data[3] = aspect;
    splatVel.data[4] = dx * config.splatForce;
    splatVel.data[5] = dy * config.splatForce;
    splatVel.data[6] = 0;
    splatVel.ubo.write(splatVel.data);
    fullscreen(splatPipeline, velocity.write, [smp(0), tex(1, velocity.read), buf(2, splatVel)]);
    velocity.swap();

    // Dye splat
    splatDye.data[0] = x; splatDye.data[1] = y;
    splatDye.data[2] = radius; splatDye.data[3] = aspect;
    splatDye.data[4] = color[0]; splatDye.data[5] = color[1]; splatDye.data[6] = color[2];
    splatDye.ubo.write(splatDye.data);
    fullscreen(splatPipeline, dye.write, [smp(0), tex(1, dye.read), buf(2, splatDye)]);
    dye.swap();
  };

  // --- Simulation step ---
  const step = (dt) => {
    const simTexel = [1 / simSize.w, 1 / simSize.h];
    const dyeTexel = [1 / dyeSize.w, 1 / dyeSize.h];

    // Advect velocity
    advVel.data[0] = simTexel[0]; advVel.data[1] = simTexel[1];
    advVel.data[2] = dt; advVel.data[3] = 0.5;
    advVel.ubo.write(advVel.data);
    fullscreen(advectionPipeline, velocity.write, [
      smp(0), tex(1, velocity.read), tex(2, velocity.read), buf(3, advVel),
    ]);
    velocity.swap();

    // Velocity blur (separable Gaussian) — horizontal
    blurH.data[0] = simTexel[0]; blurH.data[1] = simTexel[1];
    blurH.data[2] = 1; blurH.data[3] = 0;
    blurH.ubo.write(blurH.data);
    fullscreen(blurPipeline, velocity.write, [smp(0), tex(1, velocity.read), buf(2, blurH)]);
    velocity.swap();

    // Velocity blur — vertical
    blurV.data[0] = simTexel[0]; blurV.data[1] = simTexel[1];
    blurV.data[2] = 0; blurV.data[3] = 1;
    blurV.ubo.write(blurV.data);
    fullscreen(blurPipeline, velocity.write, [smp(0), tex(1, velocity.read), buf(2, blurV)]);
    velocity.swap();

    // Divergence
    divUBO.data[0] = simTexel[0]; divUBO.data[1] = simTexel[1];
    divUBO.ubo.write(divUBO.data);
    fullscreen(divergencePipeline, divergence, [smp(0), tex(1, velocity.read), buf(2, divUBO)]);

    // Clear pressure (loadOp: clear, no draw)
    chotto.pass({ target: pressure.read, clear: [0, 0, 0, 0] }, () => {});

    // Pressure solve (Jacobi iteration) — texelSize は全反復で不変なので UBO 共有可
    pressureUBO.data[0] = simTexel[0]; pressureUBO.data[1] = simTexel[1];
    pressureUBO.ubo.write(pressureUBO.data);
    for (let i = 0; i < config.pressureIterations; i++) {
      fullscreen(pressurePipeline, pressure.write, [
        smp(0), tex(1, pressure.read), tex(2, divergence), buf(3, pressureUBO),
      ]);
      pressure.swap();
    }

    // Gradient subtract
    gradUBO.data[0] = simTexel[0]; gradUBO.data[1] = simTexel[1];
    gradUBO.ubo.write(gradUBO.data);
    fullscreen(gradientPipeline, velocity.write, [
      smp(0), tex(1, pressure.read), tex(2, velocity.read), buf(3, gradUBO),
    ]);
    velocity.swap();

    // Advect dye
    advDye.data[0] = dyeTexel[0]; advDye.data[1] = dyeTexel[1];
    advDye.data[2] = dt; advDye.data[3] = config.dyeDissipation;
    advDye.ubo.write(advDye.data);
    fullscreen(advectionPipeline, dye.write, [
      smp(0), tex(1, dye.read), tex(2, velocity.read), buf(3, advDye),
    ]);
    dye.swap();
  };

  // --- GUI ---
  const gui = new GUI({ title: 'Stable Fluid (WebGPU)' });
  gui.add(config, 'dyeDissipation', 0, 5).step(0.1).name('Dye Fade');
  gui.add(config, 'pressureIterations', 1, 50).step(1).name('Pressure Iter');
  gui.add(config, 'splatSize', 1, 30).step(1).name('Splat Size');
  gui.add(config, 'splatForce', 1, 100).name('Splat Force');
  const colorController = gui.addColor(config, 'color').name('Color').onChange(() => {
    currentColor = hexToRgb(config.color);
  });
  gui.add(config, 'colorful').name('Colorful').onChange((value) => {
    if (value) {
      colorController.disable();
    } else {
      colorController.enable();
      currentColor = hexToRgb(config.color);
    }
  });
  colorController.disable();

  const dotFolder = gui.addFolder('Dot Matrix');
  dotFolder.add(config, 'dotMatrix').name('Enabled');
  dotFolder.add(config, 'dotCell', 4, 40).step(1).name('Cell Size');
  dotFolder.add(config, 'dotScale', 0.2, 1.0).step(0.05).name('Dot Size');

  gui.close();

  // --- Render loop ---
  let lastTime = performance.now();

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    // Decay smoothed velocity when not moving
    smoothedVelocity.x *= decay;
    smoothedVelocity.y *= decay;

    // Color change
    colorTimer += dt;
    if (config.colorful && colorTimer > 0.5) {
      currentColor = randomColor();
      colorTimer = 0;
    }

    chotto.frame(() => {
      // Splat if moving and inside canvas
      const speed = Math.sqrt(smoothedVelocity.x ** 2 + smoothedVelocity.y ** 2);
      if (speed > 0.0001 && pointer.isInside()) {
        const pos = pointer.getNormalizedPosition();
        // -1..1 → 0..1 (WebGL 版と同一の y-up 座標系。表示時に反転)
        const x = (pos.x + 1) * 0.5;
        const y = (pos.y + 1) * 0.5;
        splat(x, y, smoothedVelocity.x, smoothedVelocity.y, currentColor);
      }

      // Simulation
      step(dt);

      // Display to canvas (+ dot matrix post effect)
      displayUBO.data[0] = canvas.width;
      displayUBO.data[1] = canvas.height;
      displayUBO.data[2] = config.dotCell * dpr; // GUI 値は CSS px なので DPR を掛ける
      displayUBO.data[3] = config.dotScale;
      displayUBO.data[4] = config.dotMatrix ? 1 : 0;
      displayUBO.ubo.write(displayUBO.data);
      fullscreen(displayPipeline, null, [smp(0), tex(1, dye.read), buf(2, displayUBO)]);
    });

    requestAnimationFrame(render);
  };

  render();
};
