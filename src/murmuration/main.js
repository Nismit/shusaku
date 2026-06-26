import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import GUI from '../libs/lil-gui.esm.min.js';

import initWGSL from './shaders/init.wgsl?raw';
import updateWGSL from './shaders/update.wgsl?raw';
import particleWGSL from './shaders/particle.wgsl?raw';
import bgWGSL from './shaders/bg.wgsl?raw';
import screenWGSL from './shaders/screen.wgsl?raw';
import shadowWGSL from './shaders/shadow.wgsl?raw';
import velocityWGSL from './shaders/velocity.wgsl?raw';
import motionBlurWGSL from './shaders/motionblur.wgsl?raw';
import thresholdWGSL from './shaders/threshold.wgsl?raw';
import blurWGSL from './shaders/blur.wgsl?raw';
import bloomComposeWGSL from './shaders/bloomcompose.wgsl?raw';

import { buildLightMatrices } from './shadowHelper.js';

const PARTICLE_COUNT = 512 * 512;
const WORKGROUP_SIZE = 64;
const RENDER_FORMAT = 'rgba16float';
const SHADOW_MAP_SIZE = 1024;
const MAX_BLOOM_ITERATIONS = 8;

const ua = navigator.userAgent;
const IS_MOBILE = /Android|iPhone|iPod/i.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

const MSAA = IS_MOBILE ? 1 : 4;
const PCF_TAPS = IS_MOBILE ? 6 : 12;

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

// 各パレットは Ember 由来の設計則に従う:
//   ピーク(B)= 最も長く見える主役。高輝度で発光する色。
//   消滅(C) = ピークの補色側に振った暗い色。背景へ寒/暖の対比で溶ける。
//   背景    = 消滅色側に寄せた、彩度を抑えた深い色。上端→下端で僅かに持ち上げる。
const PALETTES = {
  // 炎: 暖オレンジのピーク × 寒い青の消滅
  Ember: {
    particleColor: '#b23a10', particleColorB: '#f0a030', particleColorC: '#1e3850',
    shadowColor: '#0b121c', bgTop: '#04080f', bgBottom: '#0a1320',
  },
  // オーロラ: 発光ミントグリーンのピーク × 補色マゼンタの消滅
  Aurora: {
    particleColor: '#12506e', particleColorB: '#4be8a4', particleColorC: '#4a1a5e',
    shadowColor: '#0a081e', bgTop: '#04060f', bgBottom: '#0a0a1e',
  },
  // 桜: 明るいピンクのピーク × 補色ティールの消滅
  Blossom: {
    particleColor: '#9c2848', particleColorB: '#f78fb3', particleColorC: '#173f3c',
    shadowColor: '#0f0a14', bgTop: '#07060c', bgBottom: '#120b18',
  },
  // 珊瑚礁: 発光ターコイズのピーク × 補色コーラルの消滅
  Reef: {
    particleColor: '#0a5560', particleColorB: '#2ee0c8', particleColorC: '#6e2a18',
    shadowColor: '#07110f', bgTop: '#03090d', bgBottom: '#07141c',
  },
  // 黄昏: 夕陽オレンジのピーク × 寒いインディゴの消滅
  Dusk: {
    particleColor: '#7a2858', particleColorB: '#ff9d5c', particleColorC: '#241a55',
    shadowColor: '#0c0a24', bgTop: '#060410', bgBottom: '#0e0a1e',
  },
};

const makeRandomPalette = () => {
  const birthHue = Math.random() * 360;
  const peakHue  = (birthHue + 18) % 360;
  const deathHue = (birthHue + 165 + Math.random() * 30) % 360;
  return {
    particleColor:  hslToHex(birthHue, 76, 38),
    particleColorB: hslToHex(peakHue,  70, 60),
    particleColorC: hslToHex(deathHue, 58, 20),
    shadowColor:    hslToHex(deathHue, 38, 8),
    bgTop:          hslToHex(deathHue, 26, 3),
    bgBottom:       hslToHex(deathHue, 30, 6),
  };
};

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const initialPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * initialPixelRatio);
  canvas.height = Math.floor(window.innerHeight * initialPixelRatio);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;

  const getBasePointSize = (w, h) => {
    const aspect = w / h;
    const targetAspect = 16 / 9;
    const rawBase = aspect >= targetAspect ? 3000 : 3000 * Math.max(aspect / targetAspect, 0.75);
    return rawBase / 287.5;
  };
  let basePointSize = getBasePointSize(canvas.width, canvas.height);

  const params = {
    noiseScale: 2.4,
    noiseStrength: 0.00575,
    timeScale: 1.0,
    lifetime: 1.11,
    spawnRadius: 0.2,
    expandSpeed: 0.0,
    particleSize: 0.5,
    particleAmount: IS_MOBILE ? 0.5 : 1.0,
    rotationX: 0.3,
    rotationY: 0.0,
    zoom: 3.2,
    autoRotate: false,
    autoRotateSpeed: 0.12,
    lightVertical: 1.1,
    lightHorizontal: -1.57,
    lightColor: '#ffffff',
    lightIntensity: 1.0,
    ambient: 0.42,
    shininess: 56.0,
    sssIntensity: 0.45,
    sssDistortion: 0.18,
    sssPower: 2.0,
    fresnelPower: 2.5,
    saturation: 1.35,
    contrast: 1.10,
    exposure: 1.10,
    particleColor: '#b23a10',
    particleColorB: '#f0a030',
    particleColorC: '#1e3850',
    shadowColor: '#0b121c',
    bgTop: '#04080f',
    bgBottom: '#0a1320',
    trailAmount: 0.9,
    shadowEnabled: true,
    shadowPointSize: 1.5,
    shadowDepthOffset: 0.01,
    shadowBlurRadius: 2.0,
    shadowExtent: 0.6,
    toneMapping: 1.0,
    bloomEnabled: false,
    bloomThreshold: 1.0,
    bloomStrength: 0.6,
    bloomIterations: 5,
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

  // update Params: { count: u32, time: f32, deltaFrames: f32, noiseScale: f32, noiseStrength: f32, lifetime: f32, expandSpeed: f32, _pad: f32 } = 32 bytes
  const updateUBO = chotto.buffer(32, { uniform: true });
  const updateAB = new ArrayBuffer(32);
  const updateF32 = new Float32Array(updateAB);
  const updateU32 = new Uint32Array(updateAB);

  // ShadowParams: { lightViewProj: mat4x4f, shadowPointSize: f32, shadowMapSize: f32, depthOffset: f32, _pad: f32 } = 80 bytes
  const shadowUBO = chotto.buffer(80, { uniform: true });
  const shadowData = new Float32Array(20);

  // BgParams: { bgTop: vec3f, bgBottom: vec3f } = 32 bytes (vec3f alignment 16)
  const bgUBO = chotto.buffer(32, { uniform: true });
  const bgData = new Float32Array(8);

  // VParams: { resolution: vec2f, rotation: vec2f, zoom: f32, particleSize: f32, [pad x2], lightDir: vec3f, [pad], particleColor: vec3f, [pad], particleColorB: vec3f, [pad], particleColorC: vec3f, [pad] } = 96 bytes
  const vParamsUBO = chotto.buffer(96, { uniform: true });
  const vData = new Float32Array(24);

  // FParams: { lightColor: vec3f, ambient: f32, shininess..exposure: f32 x8, shadowColor: vec3f, [pad] } = 64 bytes
  const fParamsUBO = chotto.buffer(64, { uniform: true });
  const fData = new Float32Array(16);

  // SParams: { lightViewProj: mat4x4f, shadowMapSize: f32, shadowBlurRadius: f32, shadowEnabled: f32, pcfTaps: i32 } = 80 bytes
  const sParamsUBO = chotto.buffer(80, { uniform: true });
  const sAB = new ArrayBuffer(80);
  const sF32 = new Float32Array(sAB);
  const sI32 = new Int32Array(sAB);

  // Camera (velocity): { resolution: vec2f, rotation: vec2f, zoom: f32, particleSize: f32, _pad x2 } = 32 bytes
  const velCamUBO = chotto.buffer(32, { uniform: true });
  const velData = new Float32Array(8);

  // MotionBlur Params: { resolution: vec2f, maxDistance: f32, motionMultiplier: f32, leaning: f32, _pad x3 } = 32 bytes
  const motionBlurUBO = chotto.buffer(32, { uniform: true });
  const mbData = new Float32Array(8);

  // Threshold Params: { threshold: f32 } = 16 bytes
  const thresholdUBO = chotto.buffer(16, { uniform: true });
  const threshData = new Float32Array(4);

  // Blur Params: { texelSize: vec2f, iteration: f32, _pad: f32 } = 16 bytes
  // frame() batches all passes — separate UBOs per iteration to avoid last-write-wins
  const blurUBOs = Array.from({ length: MAX_BLOOM_ITERATIONS }, () => chotto.buffer(16, { uniform: true }));
  const blurData = new Float32Array(4);

  // BloomCompose Params: { strength: f32, toneMapping: f32 } = 16 bytes
  const composeUBO = chotto.buffer(16, { uniform: true });
  const composeData = new Float32Array(4);

  // Screen Params: { toneMapping: f32 } = 16 bytes
  const screenUBO = chotto.buffer(16, { uniform: true });
  const screenData = new Float32Array(4);

  // --- Render targets ---
  const renderFBO = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT, depth: true, samples: MSAA });
  const velocityFBO = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT, depth: true });
  const motionBlurFBO = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT });
  const brightFBO = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPing = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPong = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const shadowFBO = chotto.framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, { format: RENDER_FORMAT, depth: true });

  // --- Pipelines ---
  const initPipeline = chotto.compute({ shader: initWGSL });
  const updatePipeline = chotto.compute({ shader: updateWGSL });

  const shadowPipeline = chotto.pipeline({
    vertex: shadowWGSL, fragment: shadowWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', depthTest: true,
  });

  const bgPipeline = chotto.pipeline({
    fragment: bgWGSL, format: RENDER_FORMAT, samples: MSAA,
    depthTest: true, depthWrite: false, depthCompare: 'always',
  });

  const particlePipeline = chotto.pipeline({
    vertex: particleWGSL, fragment: particleWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', depthTest: true, samples: MSAA,
  });

  const velocityPipeline = chotto.pipeline({
    vertex: velocityWGSL, fragment: velocityWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', depthTest: true,
  });

  const motionBlurPipeline = chotto.pipeline({ fragment: motionBlurWGSL, format: RENDER_FORMAT });
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

  chotto.fitWindow((w, h) => {
    basePointSize = getBasePointSize(w, h);
    renderFBO.resize(w, h);
    velocityFBO.resize(w, h);
    motionBlurFBO.resize(w, h);
    brightFBO.resize(w >> 1, h >> 1);
    blurPing.resize(w >> 1, h >> 1);
    blurPong.resize(w >> 1, h >> 1);
  });

  buildGUI();

  const timer = new Timer();
  timer.start();
  let lastRawTime = 0;
  let scaledTime = 0;

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
    const fpsScale = Math.min(1.0, 1.0 / Math.max(dt, 0.0001) / 120.0);

    chotto.frame(() => {
      // === GPGPU update (A -> B) ===
      updateU32[0] = PARTICLE_COUNT;
      updateF32[1] = scaledTime;
      updateF32[2] = deltaFrames;
      updateF32[3] = params.noiseScale;
      updateF32[4] = params.noiseStrength;
      updateF32[5] = params.lifetime;
      updateF32[6] = params.expandSpeed;
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

      // === Shadow map pass ===
      if (params.shadowEnabled) {
        shadowData.set(lightVP, 0);
        shadowData[16] = params.shadowPointSize;
        shadowData[17] = SHADOW_MAP_SIZE;
        shadowData[18] = params.shadowDepthOffset;
        shadowUBO.write(shadowData);

        chotto.pass({ target: shadowFBO, clear: { r: 1, g: 1, b: 1, a: 1 } }, (p) => {
          p.setPipeline(shadowPipeline);
          p.setBindGroup(0, bg(shadowPipeline.getBindGroupLayout(0), [
            buf(0, positionsA), buf(1, shadowUBO),
          ]));
          p.draw(4, drawCount);
        });
      }

      // === Render: bg + particles in one pass ===
      bgData.set(hexToRGB(params.bgTop), 0);
      bgData.set(hexToRGB(params.bgBottom), 4);
      bgUBO.write(bgData);

      // VParams layout (96 bytes / 24 words):
      // [0-1] resolution vec2f, [2-3] rotation vec2f, [4] zoom, [5] particleSize,
      // [6-7] pad, [8-10] lightDir vec3f, [11] pad,
      // [12-14] particleColor vec3f, [15] pad, [16-18] particleColorB vec3f, [19] pad,
      // [20-22] particleColorC vec3f, [23] pad
      vData[0] = canvas.width; vData[1] = canvas.height;
      vData[2] = params.rotationX; vData[3] = params.rotationY;
      vData[4] = params.zoom; vData[5] = params.particleSize * basePointSize;
      vData.set(lightDir, 8);
      vData.set(hexToRGB(params.particleColor), 12);
      vData.set(hexToRGB(params.particleColorB), 16);
      vData.set(hexToRGB(params.particleColorC), 20);
      vParamsUBO.write(vData);

      // FParams layout (64 bytes / 16 words):
      // [0-2] lightColor vec3f, [3] ambient, [4] shininess, [5] sssIntensity,
      // [6] sssDistortion, [7] sssPower, [8] fresnelPower, [9] saturation,
      // [10] contrast, [11] exposure, [12-14] shadowColor vec3f, [15] pad
      fData.set(scaleColor(hexToRGB(params.lightColor), params.lightIntensity), 0);
      fData[3] = params.ambient;
      fData[4] = params.shininess;
      fData[5] = params.sssIntensity;
      fData[6] = params.sssDistortion;
      fData[7] = params.sssPower;
      fData[8] = params.fresnelPower;
      fData[9] = params.saturation;
      fData[10] = params.contrast;
      fData[11] = params.exposure;
      fData.set(hexToRGB(params.shadowColor), 12);
      fParamsUBO.write(fData);

      // SParams layout (80 bytes / 20 words):
      // [0-15] lightViewProj mat4x4f, [16] shadowMapSize, [17] shadowBlurRadius,
      // [18] shadowEnabled, [19] pcfTaps (i32)
      sF32.set(lightVP, 0);
      sF32[16] = SHADOW_MAP_SIZE;
      sF32[17] = params.shadowBlurRadius;
      sF32[18] = params.shadowEnabled ? 1.0 : 0.0;
      sI32[19] = PCF_TAPS;
      sParamsUBO.write(sF32);

      const bgBindGroup = bg(bgPipeline.getBindGroupLayout(0), [buf(0, bgUBO)]);
      const particleBindGroup = bg(particlePipeline.getBindGroupLayout(0), [
        buf(0, positionsA), buf(1, vParamsUBO), buf(2, fParamsUBO), buf(3, sParamsUBO),
        smp(4), tex(5, shadowFBO.view),
      ]);

      chotto.pass({ target: renderFBO, clear: { r: 0, g: 0, b: 0, a: 1 } }, (p) => {
        p.setPipeline(bgPipeline);
        p.setBindGroup(0, bgBindGroup);
        p.draw(3);

        p.setPipeline(particlePipeline);
        p.setBindGroup(0, particleBindGroup);
        p.draw(4, drawCount);
      });

      // === Velocity buffer ===
      velData[0] = canvas.width; velData[1] = canvas.height;
      velData[2] = params.rotationX; velData[3] = params.rotationY;
      velData[4] = params.zoom; velData[5] = params.particleSize * basePointSize;
      velCamUBO.write(velData);

      chotto.pass({ target: velocityFBO, clear: [0, 0, 0, 0] }, (p) => {
        p.setPipeline(velocityPipeline);
        p.setBindGroup(0, bg(velocityPipeline.getBindGroupLayout(0), [
          buf(0, positionsA), buf(1, positionsB), buf(2, velCamUBO),
        ]));
        p.draw(4, drawCount);
      });

      // === Motion blur ===
      mbData[0] = canvas.width; mbData[1] = canvas.height;
      mbData[2] = 240.0;
      mbData[3] = params.trailAmount * fpsScale;
      mbData[4] = 0.5;
      motionBlurUBO.write(mbData);

      chotto.pass({ target: motionBlurFBO }, (p) => {
        p.setPipeline(motionBlurPipeline);
        p.setBindGroup(0, bg(motionBlurPipeline.getBindGroupLayout(0), [
          smp(0), tex(1, renderFBO.view), tex(2, velocityFBO.view), buf(3, motionBlurUBO),
        ]));
        p.draw(3);
      });

      // === Bloom or passthrough ===
      if (params.bloomEnabled) {
        const bw = canvas.width >> 1;
        const bh = canvas.height >> 1;

        threshData[0] = params.bloomThreshold;
        thresholdUBO.write(threshData);

        chotto.pass({ target: brightFBO }, (p) => {
          p.setPipeline(thresholdPipeline);
          p.setBindGroup(0, bg(thresholdPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, motionBlurFBO.view), buf(2, thresholdUBO),
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
            smp(0), tex(1, motionBlurFBO.view), tex(2, readFBO.view), buf(3, composeUBO),
          ]));
          p.draw(3);
        });
      } else {
        screenData[0] = params.toneMapping;
        screenUBO.write(screenData);

        chotto.pass((p) => {
          p.setPipeline(screenPipeline);
          p.setBindGroup(0, bg(screenPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, motionBlurFBO.view), buf(2, screenUBO),
          ]));
          p.draw(3);
        });
      }
    });

    requestAnimationFrame(render);
  };

  render();

  // --- GUI ---
  function buildGUI() {
    const gui = new GUI({ title: 'Murmuration (WebGPU)' });

    const simFolder = gui.addFolder('Simulation');
    simFolder.add(params, 'noiseScale', 0.5, 5.0).name('Noise Scale');
    simFolder.add(params, 'noiseStrength', 0.005, 0.05).name('Noise Strength');
    simFolder.add(params, 'timeScale', 0.05, 3.0, 0.05).name('Time');
    simFolder.add(params, 'lifetime', 0.3, 3.0).name('Lifetime (sec)');
    simFolder.add(params, 'spawnRadius', 0.01, 0.5).name('Spawn Radius').onChange(() => initGPGPU());
    simFolder.add(params, 'expandSpeed', 0.0, 0.05).name('Expand Speed');

    const visualFolder = gui.addFolder('Visual');
    visualFolder.add(params, 'particleSize', 0.2, 3.0, 0.05).name('Particle Size');
    visualFolder.add(params, 'particleAmount', 0.05, 1.0, 0.01).name('Particle Amount');
    visualFolder.add(params, 'trailAmount', 0.0, 6.0, 0.1).name('Light Trails');

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
    lightFolder.add(params, 'shininess', 4.0, 128.0).name('Shininess');
    lightFolder.add(params, 'fresnelPower', 1.0, 8.0, 0.5).name('Fresnel Power');
    lightFolder.add(params, 'sssIntensity', 0.0, 1.5, 0.05).name('SSS Intensity');
    lightFolder.add(params, 'sssDistortion', 0.0, 1.0, 0.05).name('SSS Distortion');
    lightFolder.add(params, 'sssPower', 0.5, 8.0, 0.5).name('SSS Power');
    lightFolder.add(params, 'saturation', 0.0, 2.5, 0.05).name('Saturation');
    lightFolder.add(params, 'contrast', 0.8, 1.8, 0.02).name('Contrast');
    lightFolder.add(params, 'exposure', 0.2, 2.5, 0.05).name('Exposure');
    lightFolder.add(params, 'toneMapping', 0.0, 1.0, 0.05).name('Tone Mapping');

    const colorFolder = gui.addFolder('Colors');

    const colorCtrls = [];
    const applyPalette = (palette) => {
      Object.assign(params, palette);
      colorCtrls.forEach(c => c.updateDisplay());
    };
    const paletteHelper = {
      preset: 'Ember',
      randomize: () => applyPalette(makeRandomPalette()),
    };
    colorFolder.add(paletteHelper, 'preset', Object.keys(PALETTES)).name('Preset')
      .onChange(name => applyPalette(PALETTES[name]));
    colorFolder.add(paletteHelper, 'randomize').name('Randomize');

    colorCtrls.push(
      colorFolder.addColor(params, 'particleColor').name('Particle (Birth)'),
      colorFolder.addColor(params, 'particleColorB').name('Particle (Peak)'),
      colorFolder.addColor(params, 'particleColorC').name('Particle (Death)'),
      colorFolder.addColor(params, 'shadowColor').name('Shadow'),
      colorFolder.addColor(params, 'bgTop').name('BG Top'),
      colorFolder.addColor(params, 'bgBottom').name('BG Bottom'),
    );

    const shadowFolder = gui.addFolder('Shadow');
    shadowFolder.add(params, 'shadowPointSize', 1.0, 10.0).name('Point Size');
    shadowFolder.add(params, 'shadowDepthOffset', 0.0, 0.05).step(0.001).name('Depth Offset');
    shadowFolder.add(params, 'shadowBlurRadius', 0.5, 6.0).name('Blur Radius');
    shadowFolder.add(params, 'shadowExtent', 0.3, 2.0).name('Extent');

    const bloomFolder = gui.addFolder('Bloom');
    bloomFolder.add(params, 'bloomEnabled').name('Enabled');
    bloomFolder.add(params, 'bloomThreshold', 0.0, 1.0).name('Threshold');
    bloomFolder.add(params, 'bloomStrength', 0.0, 2.0).name('Strength');
    bloomFolder.add(params, 'bloomIterations', 1, 8).step(1).name('Iterations');

    gui.add(params, 'seed', 0, 9999).step(1).name('Seed').onChange(() => initGPGPU());
    gui.add(params, 'reset').name('Reset');
    gui.close();
  }
};
