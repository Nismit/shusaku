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

// モバイル判定: フィルレート/帯域が低い端末ではフラグメント律速 (オーバードロー × PCF) を緩和する。
const ua = navigator.userAgent;
const IS_MOBILE = /Android|iPhone|iPod/i.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

const MSAA = IS_MOBILE ? 1 : 4;     // モバイルは MSAA オフ
const PCF_TAPS = IS_MOBILE ? 6 : 12; // モバイルはシャドウ PCF を半減

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

// 設計原則: 暗い Birth → 明るい Peak → 暗い Death。
// Death と Background は同じ色相ファミリーに揃えてパーティクルが環境に溶け込むようにする。
const PALETTES = {
  Ember: {
    // 炎が燃えて灰になる: 暗い焦げ橙 → 明るい琥珀炎 → 冷えたスレート
    particleColor: '#b23a10', particleColorB: '#f0a030', particleColorC: '#1e3850',
    shadowColor: '#0c141e', bgTop: '#060c12', bgBottom: '#0c1520',
  },
  Aurora: {
    // 極光: 深い氷青 → 鮮やかなオーロラ緑 → 濃紺の夜空
    particleColor: '#185c8c', particleColorB: '#38c898', particleColorC: '#261260',
    shadowColor: '#0c0828', bgTop: '#060412', bgBottom: '#0c081e',
  },
  Blossom: {
    // 桜: 暗い深紅のつぼみ → 明るい花びらピンク → 落花した暗い紫
    particleColor: '#8c2040', particleColorB: '#f480a8', particleColorC: '#380e3c',
    shadowColor: '#16081a', bgTop: '#0a040e', bgBottom: '#16081c',
  },
  Reef: {
    // 珊瑚礁: 深い海のティール → 輝くサンゴ緑 → 暗い深海
    particleColor: '#0e5448', particleColorB: '#2ccc7c', particleColorC: '#082420',
    shadowColor: '#041210', bgTop: '#020b08', bgBottom: '#061208',
  },
  Dusk: {
    // 夕暮れ: 深い紫 → 明るいローズマゼンタ → 夜の藍
    particleColor: '#641890', particleColorB: '#cc58b8', particleColorC: '#120c48',
    shadowColor: '#0a0822', bgTop: '#060412', bgBottom: '#0c0820',
  },
};

// Birth: 暗く高彩度 / Peak: 明るく色付き / Death: 暗く対照色 + BG は Death 色相で統一
const makeRandomPalette = () => {
  const birthHue = Math.random() * 360;
  const peakHue  = (birthHue + 18) % 360;
  const deathHue = (birthHue + 165 + Math.random() * 30) % 360;
  return {
    particleColor:  hslToHex(birthHue, 76, 38),
    particleColorB: hslToHex(peakHue,  70, 60),
    particleColorC: hslToHex(deathHue, 58, 20),
    shadowColor:    hslToHex(deathHue, 40, 8),
    bgTop:          hslToHex(deathHue, 36, 3),
    bgBottom:       hslToHex(deathHue, 36, 5),
  };
};

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
    particleAmount: IS_MOBILE ? 0.5 : 1.0, // モバイルは初期値を下げて快適域から開始

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
    ambient: 0.42,
    shininess: 56.0,
    sssIntensity: 0.45,
    sssDistortion: 0.18,
    sssPower: 2.0,
    fresnelPower: 2.5,
    saturation: 1.35,
    contrast: 1.10,
    exposure: 1.10,
    // Colors (Ember パレットがデフォルト)
    particleColor: '#b23a10',   // 誕生: 暗い焦げ橙
    particleColorB: '#f0a030',  // ピーク: 明るい琥珀炎
    particleColorC: '#1e3850',  // 消滅: 冷えたスレートブルー
    shadowColor: '#0c141e',
    bgTop: '#060c12',
    bgBottom: '#0c1520',
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
    const fpsScale = Math.min(1.0, 1.0 / Math.max(dt, 0.0001) / 120.0);

    // 1フレーム = 1コマンドエンコーダ。全パスを記録して frame() 終了時に1回だけ submit。
    chotto.frame(() => {
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

      // === Render: bg -> particles (同一レンダーパスに統合 → MSAA リゾルブ1回) ===
      renderFBO.pass([
        {
          pipeline: bgPipeline,
          uniforms: {
            bgTop: hexToRGB(params.bgTop),
            bgBottom: hexToRGB(params.bgBottom),
          },
        },
        {
          pipeline: particlePipeline,
          uniforms: {
            _vertexCount: 4,
            _instanceCount: drawCount,
            positions: positionsA,
            resolution: [canvas.width, canvas.height],
            rotation: [params.rotationX, params.rotationY],
            zoom: params.zoom,
            particleSize: params.particleSize * basePointSize,
            lightDir,
            particleColor: hexToRGB(params.particleColor),
            particleColorB: hexToRGB(params.particleColorB),
            particleColorC: hexToRGB(params.particleColorC),
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
            pcfTaps: PCF_TAPS,
            shadowMap: shadowFBO,
          },
        },
      ]);

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
    });

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
