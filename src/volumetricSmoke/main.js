import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import { PointerInput } from '../libs/PointerInput.js';
import { createLoadingProgress, tuneGPUPerformance } from '../libs/GPUPerformanceTuner.js';
import GUI from '../libs/gui.js';

import initWGSL from './shaders/init.wgsl?raw';
import updateWGSL from './shaders/update.wgsl?raw';
import lightDensityWGSL from './shaders/lightdensity.wgsl?raw';
import smokeWGSL from './shaders/smoke.wgsl?raw';
import compositeWGSL from './shaders/composite.wgsl?raw';
import thresholdWGSL from './shaders/threshold.wgsl?raw';
import blurWGSL from './shaders/blur.wgsl?raw';
import bloomComposeWGSL from './shaders/bloomcompose.wgsl?raw';
import screenWGSL from './shaders/screen.wgsl?raw';

import { buildLightMatrices } from './shadowHelper.js';

const ua = navigator.userAgent;
const IS_MOBILE = /Android|iPhone|iPod/i.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

const PARTICLE_COUNT = IS_MOBILE ? 256 * 256 : 512 * 512;
const WORKGROUP_SIZE = 64;
const RENDER_FORMAT = 'rgba16float';
const LIGHT_MAP_SIZE = 1024;
const MAX_BLOOM_ITERATIONS = 8;

const hexToRGB = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
const scaleColor = (rgb, scale) => rgb.map((c) => c * scale);

const hslToHex = (h, s, l) => {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

// 煙のパレット設計則:
//   A(誕生)   = まだ薄く光を透かす明るめのトーン。
//   B(ピーク) = 最も濃く盛り上がる主役。ハイライトが乗る色。
//   C(消滅)   = 拡散して光を失い、背景へ溶ける暗いトーン。
//   背景      = 煙が沈み込む深い色。上→下でわずかに持ち上げる。
const PALETTES = {
  // 灰: ニュートラルな煙。冷たいグレーが立ち上がり暗部へ沈む。
  Ash: {
    smokeColorA: '#9aa3ad', smokeColorB: '#d7d3c9', smokeColorC: '#1b1e24',
    bgTop: '#05070a', bgBottom: '#10141b', lightColor: '#fff4e2',
  },
  // 残り火: 暖かい下焼けの残る黒煙。オレンジが芯に灯る。
  Ember: {
    smokeColorA: '#c9682f', smokeColorB: '#f0b06a', smokeColorC: '#160e0a',
    bgTop: '#060302', bgBottom: '#180b06', lightColor: '#ffd7a0',
  },
  // 蒸気: 白く柔らかい水蒸気。冷たいハイライト。
  Steam: {
    smokeColorA: '#aeb9c4', smokeColorB: '#eef2f6', smokeColorC: '#2a333f',
    bgTop: '#070b12', bgBottom: '#141d29', lightColor: '#eaf4ff',
  },
  // 墨: 深い藍墨。青黒い煙が滲む。
  Ink: {
    smokeColorA: '#4a6076', smokeColorB: '#9fb4c8', smokeColorC: '#0a0e18',
    bgTop: '#03050b', bgBottom: '#0a1020', lightColor: '#dbe6ff',
  },
  // 毒気: 妖しい緑の煙。夜光めいたピーク。
  Toxic: {
    smokeColorA: '#4e7a3a', smokeColorB: '#b6e06a', smokeColorC: '#0c140a',
    bgTop: '#04070a', bgBottom: '#0c1610', lightColor: '#eaffce',
  },
};

const makeRandomPalette = () => {
  const hue = Math.random() * 360;
  const peakHue = (hue + 12) % 360;
  const deathHue = (hue + 180 + Math.random() * 40) % 360;
  const bgHue = (deathHue + 20 + Math.random() * 40) % 360;
  const bgLight = 5 + Math.random() * 9;
  return {
    smokeColorA: hslToHex(hue, 26, 58),
    smokeColorB: hslToHex(peakHue, 30, 78),
    smokeColorC: hslToHex(deathHue, 34, 12),
    bgTop: hslToHex(bgHue, 40, bgLight),
    bgBottom: hslToHex((bgHue + 28) % 360, 44, bgLight + 6),
    lightColor: hslToHex((peakHue + 20) % 360, 22, 92),
  };
};

export const main = async () => {
  const loading = createLoadingProgress();
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const initialPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * initialPixelRatio);
  canvas.height = Math.floor(window.innerHeight * initialPixelRatio);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;
  loading.update(0.03, 'Preparing graphics');

  let renderScale = 1;

  const getBasePointSize = (w, h) => {
    const aspect = w / h;
    const targetAspect = 16 / 9;
    const rawBase = aspect >= targetAspect ? 3000 : 3000 * Math.max(aspect / targetAspect, 0.75);
    return rawBase / 287.5;
  };
  let basePointSize = getBasePointSize(canvas.width, canvas.height);

  const params = {
    // --- Simulation ---
    noiseScale: 2.4,
    noiseStrength: 0.00575,
    timeScale: 0.45,
    lifetime: 1.11,
    spawnRadius: 0.2,
    spawnOffsetY: -0.35,
    initialRise: 0.018,
    // --- Dry-ice behavior: 沈んで床を漂い消えていく冷気 ---
    sinkStrength: 0.006,
    floorSpread: 0.007,
    floorY: -0.5,
    // --- Smoke rendering ---
    particleAmount: IS_MOBILE ? 0.5 : 1.0,
    puffSize: 3.5,
    softness: 2.2,
    density: 0.55,
    densityScale: 1.6,
    absorption: 2.2,
    scatter: 1.5,
    ambient: 0.45,
    wrap: 0.4,
    // --- Camera ---
    rotationX: 0.3,
    rotationY: 0.0,
    zoom: IS_MOBILE ? 2.3 : 3.2,
    autoRotate: false,
    autoRotateSpeed: 0.12,
    // --- Lighting / self-shadow ---
    lightVertical: 1.1,
    lightHorizontal: -1.57,
    lightColor: '#fff4e2',
    lightIntensity: 1.4,
    shadowExtent: 0.6,
    lightPuffSize: 76.0,
    lightDensityScale: 0.5,
    lightSoftness: 2.0,
    shadowSoftness: 1.6,
    // --- Grading ---
    saturation: 1.05,
    contrast: 1.06,
    exposure: 1.5,
    toneMapping: 1.0,
    // --- Colors ---
    smokeColorA: '#9aa3ad',
    smokeColorB: '#d7d3c9',
    smokeColorC: '#1b1e24',
    bgTop: '#05070a',
    bgBottom: '#10141b',
    // --- Bloom ---
    bloomEnabled: false,
    bloomThreshold: 0.7,
    bloomStrength: 0.5,
    bloomIterations: 5,
    // --- Interaction ---
    burstStrength: 0.032,
    burstWaveSpeed: 1.4,
    burstThickness: 0.14,
    burstDecay: 2.2,
    seed: Math.floor(Math.random() * 10000),
    reset: () => initGPGPU(),
  };

  // --- Storage buffers (ping-pong) ---
  const initData = new Float32Array(PARTICLE_COUNT * 4);
  let positionsA = chotto.buffer(initData, { storage: true });
  let positionsB = chotto.buffer(initData, { storage: true });
  const defaultPositions = chotto.buffer(initData, { storage: true });

  // --- Uniform buffers ---
  // init Params: { count: u32, seed: f32, spawnRadius: f32, _pad: f32 } = 16 bytes
  const initUBO = chotto.buffer(16, { uniform: true });
  const initAB = new ArrayBuffer(16);
  const initF32 = new Float32Array(initAB);
  const initU32 = new Uint32Array(initAB);

  // update Params: 6 scalars + 2 pad (32B) + heavy vec4 (16B) + burst vec4 (16B) + burstParams vec4 (16B) = 80 bytes
  const updateUBO = chotto.buffer(80, { uniform: true });
  const updateAB = new ArrayBuffer(80);
  const updateF32 = new Float32Array(updateAB);
  const updateU32 = new Uint32Array(updateAB);

  // LParams (light density): mat4 (64) + pointSize + mapSize + densityScale + softness = 80 bytes
  const lParamsUBO = chotto.buffer(80, { uniform: true });
  const lData = new Float32Array(20);

  // VParams (smoke vertex): mat4 (64) + res vec2 + rot vec2 + zoom + puffSize + pad2 + lightDir vec3 + pad = 112 bytes
  const vParamsUBO = chotto.buffer(112, { uniform: true });
  const vData = new Float32Array(28);

  // FParams (smoke fragment): 96 bytes / 24 words
  const fParamsUBO = chotto.buffer(96, { uniform: true });
  const fData = new Float32Array(24);

  // CParams (composite): 48 bytes / 12 words
  const composeSmokeUBO = chotto.buffer(48, { uniform: true });
  const cData = new Float32Array(12);

  // Threshold Params: { threshold: f32 } = 16 bytes
  const thresholdUBO = chotto.buffer(16, { uniform: true });
  const threshData = new Float32Array(4);

  // Blur Params: separate UBO per iteration
  const blurUBOs = Array.from({ length: MAX_BLOOM_ITERATIONS }, () => chotto.buffer(16, { uniform: true }));
  const blurData = new Float32Array(4);

  // BloomCompose Params: { strength: f32, toneMapping: f32 } = 16 bytes
  const composeUBO = chotto.buffer(16, { uniform: true });
  const composeData = new Float32Array(4);

  // Screen Params: { toneMapping: f32 } = 16 bytes
  const screenUBO = chotto.buffer(16, { uniform: true });
  const screenData = new Float32Array(4);

  // --- Render targets ---
  const lightDensityFBO = chotto.framebuffer(LIGHT_MAP_SIZE, LIGHT_MAP_SIZE, { format: RENDER_FORMAT });
  const smokeFBO = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT });
  const compositeFBO = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT });
  const brightFBO = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPing = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPong = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });

  // --- Pipelines ---
  const initPipeline = chotto.compute({ shader: initWGSL });
  const updatePipeline = chotto.compute({ shader: updateWGSL });

  const additiveBlend = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  };

  const lightDensityPipeline = chotto.pipeline({
    vertex: lightDensityWGSL, fragment: lightDensityWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', blend: additiveBlend,
  });

  const smokePipeline = chotto.pipeline({
    vertex: smokeWGSL, fragment: smokeWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', blend: additiveBlend,
  });

  const compositePipeline = chotto.pipeline({ fragment: compositeWGSL, format: RENDER_FORMAT });
  const thresholdPipeline = chotto.pipeline({ fragment: thresholdWGSL, format: RENDER_FORMAT });
  const blurPipeline = chotto.pipeline({ fragment: blurWGSL, format: RENDER_FORMAT });
  const composePipeline = chotto.pipeline({ fragment: bloomComposeWGSL });
  const screenPipeline = chotto.pipeline({ fragment: screenWGSL });

  const workgroupCount = Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE);

  // --- Bind group helpers ---
  const bg = (layout, entries) => device.createBindGroup({ layout, entries });
  const buf = (binding, b) => ({ binding, resource: { buffer: b.buffer } });
  const tex = (binding, view) => ({ binding, resource: view });
  const smp = (binding) => ({ binding, resource: chotto.sampler });

  // --- Init ---
  const initGPGPU = () => {
    initU32[0] = PARTICLE_COUNT;
    initF32[1] = params.seed;
    initF32[2] = params.spawnRadius;
    initF32[3] = params.spawnOffsetY;
    initUBO.write(initF32);

    [defaultPositions, positionsA, positionsB].forEach((posBuf) => {
      chotto.dispatch((p) => {
        p.setPipeline(initPipeline);
        p.setBindGroup(0, bg(initPipeline.getBindGroupLayout(0), [
          buf(0, posBuf), buf(1, initUBO),
        ]));
        p.dispatchWorkgroups(workgroupCount);
      });
    });
  };
  initGPGPU();

  const resizeRendering = () => {
    const w = Math.max(1, Math.floor(window.innerWidth * initialPixelRatio * renderScale));
    const h = Math.max(1, Math.floor(window.innerHeight * initialPixelRatio * renderScale));
    canvas.width = w;
    canvas.height = h;
    basePointSize = getBasePointSize(w, h);
    smokeFBO.resize(w, h);
    compositeFBO.resize(w, h);
    brightFBO.resize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    blurPing.resize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    blurPong.resize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  };
  window.addEventListener('resize', resizeRendering);

  buildGUI();

  const fpsGraph = new FPSGraph();
  const timer = new Timer();
  timer.start();
  let lastRawTime = 0;
  let scaledTime = 0;

  // --- Pointer interaction: tap/click shockwave ---
  const BURST_MAX_AGE = 6.0;
  const burst = { pos: [0, 0, 0], start: -1e9, active: false };

  const rotX = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]]; };
  const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]]; };
  const screenToWorld = (n) => {
    const aspect = canvas.width / canvas.height;
    const scale = 2.0 / params.zoom;
    const view = [n.x * aspect * scale, n.y * scale, 0];
    return rotY(rotX(view, -params.rotationX), -params.rotationY);
  };

  const pointer = new PointerInput(canvas);
  pointer.onPress((p) => {
    burst.pos = screenToWorld(p.normalized);
    burst.start = scaledTime;
    burst.active = true;
  });

  const render = () => {
    const rawTime = timer.getElapsedTime();
    const rawDt = rawTime - lastRawTime;
    lastRawTime = rawTime;
    const dt = rawDt * params.timeScale;
    scaledTime += dt;
    const deltaFrames = Math.min(dt * 60.0, 4.0);

    if (params.autoRotate) params.rotationY = scaledTime * params.autoRotateSpeed;

    const drawCount = Math.max(1, Math.floor(PARTICLE_COUNT * params.particleAmount));
    const cosV = Math.cos(params.lightVertical);
    const lightDir = [
      cosV * Math.sin(params.lightHorizontal),
      Math.sin(params.lightVertical),
      cosV * Math.cos(params.lightHorizontal),
    ];
    const lightVP = buildLightMatrices(lightDir, params.shadowExtent);

    chotto.frame(() => {
      // === GPGPU update (A -> B) ===
      updateU32[0] = PARTICLE_COUNT;
      updateF32[1] = scaledTime;
      updateF32[2] = deltaFrames;
      updateF32[3] = params.noiseScale;
      updateF32[4] = params.noiseStrength;
      updateF32[5] = params.lifetime;
      updateF32[6] = params.initialRise;
      // [7] padding for vec4 alignment

      // heavy vec4 (8-11): y=沈降強度, z=水平拡散, w=床の高さ
      updateF32[9] = params.sinkStrength;
      updateF32[10] = params.floorSpread;
      updateF32[11] = params.floorY;

      const burstAge = scaledTime - burst.start;
      if (burst.active && burstAge > BURST_MAX_AGE) burst.active = false;
      updateF32[12] = burst.pos[0];
      updateF32[13] = burst.pos[1];
      updateF32[14] = burst.pos[2];
      updateF32[15] = burstAge;
      updateF32[16] = burst.active ? params.burstStrength : 0.0;
      updateF32[17] = params.burstWaveSpeed;
      updateF32[18] = params.burstThickness;
      updateF32[19] = params.burstDecay;
      updateUBO.write(updateF32);

      chotto.dispatch((p) => {
        p.setPipeline(updatePipeline);
        p.setBindGroup(0, bg(updatePipeline.getBindGroupLayout(0), [
          buf(0, positionsA), buf(1, positionsB),
          buf(2, defaultPositions), buf(3, updateUBO),
        ]));
        p.dispatchWorkgroups(workgroupCount);
      });
      [positionsA, positionsB] = [positionsB, positionsA];

      // === Light-space density map (self-shadow source) ===
      lData.set(lightVP, 0);
      lData[16] = params.lightPuffSize;
      lData[17] = LIGHT_MAP_SIZE;
      lData[18] = params.lightDensityScale;
      lData[19] = params.lightSoftness;
      lParamsUBO.write(lData);

      chotto.pass({ target: lightDensityFBO, clear: [0, 0, 0, 0] }, (p) => {
        p.setPipeline(lightDensityPipeline);
        p.setBindGroup(0, bg(lightDensityPipeline.getBindGroupLayout(0), [
          buf(0, positionsA), buf(1, lParamsUBO),
        ]));
        p.draw(4, drawCount);
      });

      // === Smoke accumulation (order-independent weighted additive) ===
      // VParams layout (112 bytes / 28 words):
      // [0-15] lightViewProj, [16-17] resolution, [18-19] rotation,
      // [20] zoom, [21] puffSize, [22-23] pad, [24-26] lightDir, [27] pad
      vData.set(lightVP, 0);
      vData[16] = canvas.width; vData[17] = canvas.height;
      vData[18] = params.rotationX; vData[19] = params.rotationY;
      vData[20] = params.zoom; vData[21] = params.puffSize * basePointSize;
      vData.set(lightDir, 24);
      vParamsUBO.write(vData);

      // FParams layout (96 bytes / 24 words):
      // [0-2] lightColor, [3] ambient, [4] absorption, [5] scatter,
      // [6] lightMapSize, [7] shadowSoftness, [8] wrap, [9] density,
      // [10] softness, [11] pad, [12-14] colorA, [16-18] colorB, [20-22] colorC
      fData.set(scaleColor(hexToRGB(params.lightColor), params.lightIntensity), 0);
      fData[3] = params.ambient;
      fData[4] = params.absorption;
      fData[5] = params.scatter;
      fData[6] = LIGHT_MAP_SIZE;
      fData[7] = params.shadowSoftness;
      fData[8] = params.wrap;
      fData[9] = params.density;
      fData[10] = params.softness;
      fData.set(hexToRGB(params.smokeColorA), 12);
      fData.set(hexToRGB(params.smokeColorB), 16);
      fData.set(hexToRGB(params.smokeColorC), 20);
      fParamsUBO.write(fData);

      chotto.pass({ target: smokeFBO, clear: [0, 0, 0, 0] }, (p) => {
        p.setPipeline(smokePipeline);
        p.setBindGroup(0, bg(smokePipeline.getBindGroupLayout(0), [
          buf(0, positionsA), buf(1, vParamsUBO), buf(2, fParamsUBO),
          smp(3), tex(4, lightDensityFBO.view),
        ]));
        p.draw(4, drawCount);
      });

      // === Composite smoke over background gradient ===
      // CParams layout (48 bytes / 12 words):
      // [0-2] bgTop, [3] densityScale, [4-6] bgBottom, [7] exposure,
      // [8] saturation, [9] contrast, [10-11] pad
      cData.set(hexToRGB(params.bgTop), 0);
      cData[3] = params.densityScale;
      cData.set(hexToRGB(params.bgBottom), 4);
      cData[7] = params.exposure;
      cData[8] = params.saturation;
      cData[9] = params.contrast;
      composeSmokeUBO.write(cData);

      chotto.pass({ target: compositeFBO, clear: [0, 0, 0, 1] }, (p) => {
        p.setPipeline(compositePipeline);
        p.setBindGroup(0, bg(compositePipeline.getBindGroupLayout(0), [
          smp(0), tex(1, smokeFBO.view), buf(2, composeSmokeUBO),
        ]));
        p.draw(3);
      });

      // === Bloom or passthrough to screen ===
      if (params.bloomEnabled) {
        const bw = canvas.width >> 1;
        const bh = canvas.height >> 1;

        threshData[0] = params.bloomThreshold;
        thresholdUBO.write(threshData);

        chotto.pass({ target: brightFBO }, (p) => {
          p.setPipeline(thresholdPipeline);
          p.setBindGroup(0, bg(thresholdPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, compositeFBO.view), buf(2, thresholdUBO),
          ]));
          p.draw(3);
        });

        let readFBO = brightFBO;
        for (let i = 0; i < params.bloomIterations; i++) {
          const writeFBO = (i % 2 === 0) ? blurPing : blurPong;
          blurData[0] = 1.0 / bw;
          blurData[1] = 1.0 / bh;
          blurData[2] = i;
          blurUBOs[i].write(blurData);

          const readView = readFBO.view;
          const ubo = blurUBOs[i];
          chotto.pass({ target: writeFBO }, (p) => {
            p.setPipeline(blurPipeline);
            p.setBindGroup(0, bg(blurPipeline.getBindGroupLayout(0), [
              smp(0), tex(1, readView), buf(2, ubo),
            ]));
            p.draw(3);
          });
          readFBO = writeFBO;
        }

        composeData[0] = params.bloomStrength;
        composeData[1] = params.toneMapping;
        composeUBO.write(composeData);

        chotto.pass((p) => {
          p.setPipeline(composePipeline);
          p.setBindGroup(0, bg(composePipeline.getBindGroupLayout(0), [
            smp(0), tex(1, compositeFBO.view), tex(2, readFBO.view), buf(3, composeUBO),
          ]));
          p.draw(3);
        });
      } else {
        screenData[0] = params.toneMapping;
        screenUBO.write(screenData);

        chotto.pass((p) => {
          p.setPipeline(screenPipeline);
          p.setBindGroup(0, bg(screenPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, compositeFBO.view), buf(2, screenUBO),
          ]));
          p.draw(3);
        });
      }
    });

    if (!benchmarking) {
      fpsGraph.update();
      requestAnimationFrame(render);
    }
  };

  let benchmarking = true;
  const qualityProfiles = [
    { name: 'High', renderScale: 1.0, particleAmount: 1.0 },
    { name: 'Balanced', renderScale: 0.9, particleAmount: 0.75 },
    { name: 'Medium', renderScale: 0.75, particleAmount: 0.5 },
    { name: 'Low', renderScale: 0.6, particleAmount: 0.3 },
  ];

  const tuning = await tuneGPUPerformance({
    device,
    profiles: qualityProfiles,
    applyProfile: (profile) => {
      renderScale = profile.renderScale;
      params.particleAmount = profile.particleAmount;
      resizeRendering();
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
  lastRawTime = 0;
  await loading.finish();
  render();

  // --- GUI ---
  function buildGUI() {
    const gui = new GUI({ title: 'Volumetric Smoke (WebGPU)' });

    const simFolder = gui.addFolder('Simulation');
    simFolder.add(params, 'noiseScale', 0.5, 5.0).name('Noise Scale');
    simFolder.add(params, 'noiseStrength', 0.005, 0.05).name('Noise Strength');
    simFolder.add(params, 'timeScale', 0.05, 3.0, 0.05).name('Time');
    simFolder.add(params, 'lifetime', 0.3, 3.0).name('Lifetime (sec)');
    simFolder.add(params, 'spawnRadius', 0.01, 0.5).name('Spawn Radius').onChange(() => initGPGPU());
    simFolder.add(params, 'spawnOffsetY', -1.0, 1.0, 0.01).name('Spawn Y Offset').onChange(() => initGPGPU());
    simFolder.add(params, 'initialRise', 0.0, 0.03, 0.001).name('Initial Rise');
    simFolder.add(params, 'sinkStrength', 0.0, 0.02, 0.001).name('Sink');
    simFolder.add(params, 'floorSpread', 0.0, 0.02, 0.001).name('Floor Spread');
    simFolder.add(params, 'floorY', -1.0, 0.0, 0.01).name('Floor Height');

    const smokeFolder = gui.addFolder('Smoke');
    smokeFolder.add(params, 'particleAmount', 0.05, 1.0, 0.01).name('Particle Amount');
    smokeFolder.add(params, 'puffSize', 0.5, 6.0, 0.05).name('Puff Size');
    smokeFolder.add(params, 'softness', 0.5, 6.0, 0.1).name('Puff Softness');
    smokeFolder.add(params, 'density', 0.05, 2.0, 0.01).name('Puff Density');
    smokeFolder.add(params, 'densityScale', 0.2, 5.0, 0.05).name('Opacity');

    const cameraFolder = gui.addFolder('Camera');
    cameraFolder.add(params, 'rotationX', -1.57, 1.57).name('Vertical');
    cameraFolder.add(params, 'rotationY', -3.14, 3.14).name('Horizontal').listen();
    cameraFolder.add(params, 'zoom', 2.0, 5.0).name('Zoom');
    cameraFolder.add(params, 'autoRotate').name('Auto Rotate');
    cameraFolder.add(params, 'autoRotateSpeed', 0.0, 0.5).name('Rotate Speed');

    const lightFolder = gui.addFolder('Lighting');
    lightFolder.add(params, 'lightVertical', -1.57, 1.57).name('Vertical');
    lightFolder.add(params, 'lightHorizontal', -3.14, 3.14).name('Horizontal');
    lightFolder.addColor(params, 'lightColor').name('Light Color');
    lightFolder.add(params, 'lightIntensity', 0.0, 3.0, 0.05).name('Light Intensity');
    lightFolder.add(params, 'ambient', 0.0, 1.2, 0.02).name('Ambient');
    lightFolder.add(params, 'scatter', 0.0, 3.0, 0.05).name('Scatter');
    lightFolder.add(params, 'absorption', 0.0, 6.0, 0.1).name('Absorption');
    lightFolder.add(params, 'wrap', 0.0, 1.0, 0.02).name('Form Shading');

    const shadowFolder = gui.addFolder('Self-Shadow');
    shadowFolder.add(params, 'shadowExtent', 0.3, 2.0).name('Extent');
    shadowFolder.add(params, 'lightPuffSize', 8.0, 160.0, 1.0).name('Light Puff Size');
    shadowFolder.add(params, 'lightDensityScale', 0.05, 2.0, 0.05).name('Light Density');
    shadowFolder.add(params, 'lightSoftness', 0.5, 6.0, 0.1).name('Light Softness');
    shadowFolder.add(params, 'shadowSoftness', 0.0, 5.0, 0.1).name('Shadow Blur');

    const gradeFolder = gui.addFolder('Grading');
    gradeFolder.add(params, 'saturation', 0.0, 2.5, 0.05).name('Saturation');
    gradeFolder.add(params, 'contrast', 0.8, 1.8, 0.02).name('Contrast');
    gradeFolder.add(params, 'exposure', 0.2, 2.5, 0.05).name('Exposure');
    gradeFolder.add(params, 'toneMapping', 0.0, 1.0, 0.05).name('Tone Mapping');

    const colorFolder = gui.addFolder('Colors');
    const colorCtrls = [];
    const applyPalette = (palette) => {
      Object.assign(params, palette);
      colorCtrls.forEach(c => c.updateDisplay());
    };
    const paletteHelper = {
      preset: 'Ash',
      randomize: () => applyPalette(makeRandomPalette()),
    };
    colorFolder.add(paletteHelper, 'preset', Object.keys(PALETTES)).name('Preset')
      .onChange(name => applyPalette(PALETTES[name]));
    colorFolder.add(paletteHelper, 'randomize').name('Randomize');

    colorCtrls.push(
      colorFolder.addColor(params, 'smokeColorA').name('Smoke (Birth)'),
      colorFolder.addColor(params, 'smokeColorB').name('Smoke (Peak)'),
      colorFolder.addColor(params, 'smokeColorC').name('Smoke (Death)'),
      colorFolder.addColor(params, 'lightColor').name('Light'),
      colorFolder.addColor(params, 'bgTop').name('BG Top'),
      colorFolder.addColor(params, 'bgBottom').name('BG Bottom'),
    );

    const bloomFolder = gui.addFolder('Bloom');
    bloomFolder.add(params, 'bloomEnabled').name('Enabled');
    bloomFolder.add(params, 'bloomThreshold', 0.0, 1.0).name('Threshold');
    bloomFolder.add(params, 'bloomStrength', 0.0, 2.0).name('Strength');
    bloomFolder.add(params, 'bloomIterations', 1, 8).step(1).name('Iterations');

    const interactFolder = gui.addFolder('Interaction');
    interactFolder.add(params, 'burstStrength', 0.0, 0.08, 0.002).name('Tap Burst');
    interactFolder.add(params, 'burstWaveSpeed', 0.2, 4.0, 0.05).name('Wave Speed');
    interactFolder.add(params, 'burstThickness', 0.03, 0.5, 0.01).name('Wave Width');
    interactFolder.add(params, 'burstDecay', 0.5, 5.0, 0.1).name('Burst Decay');

    gui.add(params, 'seed', 0, 9999).step(1).name('Seed').onChange(() => initGPGPU());
    gui.add(params, 'reset').name('Reset');
    gui.close();
    gui.hide();
  }
};
