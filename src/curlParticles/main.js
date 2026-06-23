import { chottoGPU } from '../libs/esChottoGPU.js';
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
const MSAA = 4;

const hexToRGB = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
const scaleColor = (rgb, scale) => rgb.map((c) => c * scale);

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  // FBO 作成・basePointSize 計算の前に描画バッファを実サイズへ
  // (これを怠ると FBO がデフォルト 300x150 で作られ、初回フレームが低解像度になる)
  const initialPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * initialPixelRatio);
  canvas.height = Math.floor(window.innerHeight * initialPixelRatio);

  const chotto = await chottoGPU(canvas);

  const getBasePointSize = (w, h) => {
    const aspect = w / h;
    const targetAspect = 16 / 9;
    const rawBase = aspect >= targetAspect ? 3000 : 3000 * Math.max(aspect / targetAspect, 0.75);
    return rawBase / 287.5;
  };
  let basePointSize = getBasePointSize(canvas.width, canvas.height);

  const params = {
    // Simulation
    noiseScale: 2.4,
    noiseStrength: 0.00575,
    timeScale: 1.0,
    lifetime: 1.11,
    spawnRadius: 0.2,
    expandSpeed: 0.0,
    particleSize: 0.5,
    particleAmount: 1.0,
    // Camera
    rotationX: 0.3,
    rotationY: 0.0,
    zoom: 3.2,
    autoRotate: false,
    autoRotateSpeed: 0.12,
    // Lighting
    lightVertical: 1.1,
    lightHorizontal: -1.57,
    lightColor: '#ffffff',
    lightIntensity: 1.0,
    ambient: 0.56,
    shininess: 48.0,
    sssIntensity: 0.35,
    sssDistortion: 0.2,
    sssPower: 2.0,
    fresnelPower: 3.0,
    saturation: 1.25,
    contrast: 1.12,
    exposure: 1.05,
    // Colors
    particleColor: '#ffffff',
    shadowColor: '#2f4c52',
    bgTop: '#173038',
    bgBottom: '#3d626b',
    // Motion blur
    trailAmount: 0.9,
    // Shadow
    shadowEnabled: true,
    shadowPointSize: 1.5,
    shadowDepthOffset: 0.01,
    shadowBlurRadius: 2.0,
    shadowExtent: 0.6,
    // Tone mapping
    toneMapping: 1.0,
    // Bloom
    bloomEnabled: false,
    bloomThreshold: 1.0,
    bloomStrength: 0.6,
    bloomIterations: 5,
    // Seed
    seed: Math.floor(Math.random() * 10000),
    reset: () => initGPGPU(),
  };

  // --- Storage buffers (ping-pong) ---
  const initData = new Float32Array(PARTICLE_COUNT * 4);
  let positionsA = chotto.createBuffer(initData, { storage: true });
  let positionsB = chotto.createBuffer(initData, { storage: true });
  const defaultPositions = chotto.createBuffer(initData, { storage: true });

  // --- Render targets ---
  let renderFBO = chotto.createFramebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT, depth: true, samples: MSAA });
  let velocityFBO = chotto.createFramebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT, depth: true });
  let motionBlurFBO = chotto.createFramebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT });
  let brightFBO = chotto.createFramebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  let blurPing = chotto.createFramebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  let blurPong = chotto.createFramebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });

  const shadowFBO = chotto.createFramebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, { format: RENDER_FORMAT, depth: true });

  // --- Pipelines ---
  const initPipeline = chotto.createCompute({ shader: initWGSL });
  const updatePipeline = chotto.createCompute({ shader: updateWGSL });

  const shadowPipeline = chotto.createPipeline({
    vertex: shadowWGSL, fragment: shadowWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', depthTest: true,
  });

  const bgPipeline = chotto.createPipeline({
    fragment: bgWGSL, format: RENDER_FORMAT, samples: MSAA,
    depthTest: true, depthWrite: false, depthCompare: 'always',
  });

  const particlePipeline = chotto.createPipeline({
    vertex: particleWGSL, fragment: particleWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', depthTest: true, samples: MSAA,
  });

  const velocityPipeline = chotto.createPipeline({
    vertex: velocityWGSL, fragment: velocityWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip', depthTest: true,
  });

  const motionBlurPipeline = chotto.createPipeline({ fragment: motionBlurWGSL, format: RENDER_FORMAT });
  const thresholdPipeline = chotto.createPipeline({ fragment: thresholdWGSL, format: RENDER_FORMAT });
  const blurPipeline = chotto.createPipeline({ fragment: blurWGSL, format: RENDER_FORMAT });
  const composePipeline = chotto.createPipeline({ fragment: bloomComposeWGSL });
  const screenPipeline = chotto.createPipeline({ fragment: screenWGSL });

  const workgroups = [Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE)];

  // --- Init: defaultPositions / A / B を同一シードで埋める ---
  const initGPGPU = () => {
    const u = (buf) => ({ positions: buf, count: PARTICLE_COUNT, seed: params.seed, spawnRadius: params.spawnRadius });
    chotto.dispatch(initPipeline, workgroups, u(defaultPositions));
    chotto.dispatch(initPipeline, workgroups, u(positionsA));
    chotto.dispatch(initPipeline, workgroups, u(positionsB));
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

    // === GPGPU update (A -> B) ===
    chotto.dispatch(updatePipeline, workgroups, {
      positionsIn: positionsA,
      positionsOut: positionsB,
      defaultPositions,
      count: PARTICLE_COUNT,
      time: scaledTime,
      deltaFrames,
      noiseScale: params.noiseScale,
      noiseStrength: params.noiseStrength,
      lifetime: params.lifetime,
      expandSpeed: params.expandSpeed,
    });
    [positionsA, positionsB] = [positionsB, positionsA];

    // === Shadow map pass ===
    if (params.shadowEnabled) {
      shadowFBO.pass(shadowPipeline, {
        _clear: { r: 1, g: 1, b: 1, a: 1 },
        _vertexCount: 4,
        _instanceCount: drawCount,
        positions: positionsA,
        lightViewProj: lightVP,
        shadowPointSize: params.shadowPointSize,
        shadowMapSize: SHADOW_MAP_SIZE,
        depthOffset: params.shadowDepthOffset,
      });
    }

    // === Render: bg -> particles ===
    renderFBO.pass(bgPipeline, {
      bgTop: hexToRGB(params.bgTop),
      bgBottom: hexToRGB(params.bgBottom),
    });

    renderFBO.pass(particlePipeline, {
      _clear: false,
      _vertexCount: 4,
      _instanceCount: drawCount,
      positions: positionsA,
      resolution: [canvas.width, canvas.height],
      rotation: [params.rotationX, params.rotationY],
      zoom: params.zoom,
      particleSize: params.particleSize * basePointSize,
      lightDir,
      particleColor: hexToRGB(params.particleColor),
      lightColor: scaleColor(hexToRGB(params.lightColor), params.lightIntensity),
      ambient: params.ambient,
      shininess: params.shininess,
      sssIntensity: params.sssIntensity,
      sssDistortion: params.sssDistortion,
      sssPower: params.sssPower,
      fresnelPower: params.fresnelPower,
      saturation: params.saturation,
      contrast: params.contrast,
      exposure: params.exposure,
      shadowColor: hexToRGB(params.shadowColor),
      lightViewProj: lightVP,
      shadowMapSize: SHADOW_MAP_SIZE,
      shadowBlurRadius: params.shadowBlurRadius,
      shadowEnabled: params.shadowEnabled ? 1.0 : 0.0,
      shadowMap: shadowFBO,
    });

    // === Velocity buffer ===
    velocityFBO.pass(velocityPipeline, {
      _clear: { r: 0, g: 0, b: 0, a: 0 },
      _vertexCount: 4,
      _instanceCount: drawCount,
      positions: positionsA,
      prevPositions: positionsB,
      resolution: [canvas.width, canvas.height],
      rotation: [params.rotationX, params.rotationY],
      zoom: params.zoom,
      particleSize: params.particleSize * basePointSize,
    });

    // === Motion blur ===
    const fpsScale = Math.min(1.0, 1.0 / Math.max(dt, 0.0001) / 120.0);
    motionBlurFBO.pass(motionBlurPipeline, {
      uTexture: renderFBO,
      uVelocity: velocityFBO,
      resolution: [canvas.width, canvas.height],
      maxDistance: 240.0,
      motionMultiplier: params.trailAmount * fpsScale,
      leaning: 0.5,
    });

    // === Bloom or passthrough ===
    if (params.bloomEnabled) {
      const bw = canvas.width >> 1;
      const bh = canvas.height >> 1;
      const texelSize = [1.0 / bw, 1.0 / bh];

      brightFBO.pass(thresholdPipeline, { uTexture: motionBlurFBO, threshold: params.bloomThreshold });

      let readFBO = brightFBO;
      for (let i = 0; i < params.bloomIterations; i++) {
        const writeFBO = (i % 2 === 0) ? blurPing : blurPong;
        writeFBO.pass(blurPipeline, { uTexture: readFBO, texelSize, iteration: i });
        readFBO = writeFBO;
      }

      chotto.pass(composePipeline, { uOriginal: motionBlurFBO, uBloom: readFBO, strength: params.bloomStrength, toneMapping: params.toneMapping });
    } else {
      chotto.pass(screenPipeline, { uTexture: motionBlurFBO, toneMapping: params.toneMapping });
    }

    requestAnimationFrame(render);
  };

  render();

  // --- GUI ---
  function buildGUI() {
    const gui = new GUI({ title: 'Curl Particles (WebGPU)' });

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
    colorFolder.addColor(params, 'particleColor').name('Particle');
    colorFolder.addColor(params, 'shadowColor').name('Shadow');
    colorFolder.addColor(params, 'bgTop').name('BG Top');
    colorFolder.addColor(params, 'bgBottom').name('BG Bottom');

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
