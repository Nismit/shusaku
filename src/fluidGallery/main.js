import { chottoGL } from '../libs/esChottoGL.js';
import { PointerInput } from '../libs/PointerInput.js';
import GUI from '../libs/lil-gui.esm.min.js';

import advectionFrag from './shaders/advection.frag?raw';
import splatFrag from './shaders/splat.frag?raw';
import divergenceFrag from './shaders/divergence.frag?raw';
import pressureFrag from './shaders/pressure.frag?raw';
import gradientFrag from './shaders/gradient.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import displayFrag from './shaders/display.frag?raw';

// Simplex noise implementation for smooth auto cursor movement
const SimplexNoise = (() => {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];

  return class {
    constructor(seed = Math.random() * 65536) {
      this.perm = new Uint8Array(512);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      let s = seed;
      for (let i = 255; i > 0; i--) {
        s = (s * 16807) % 2147483647;
        const j = s % (i + 1);
        [p[i], p[j]] = [p[j], p[i]];
      }
      for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    }

    noise2D(x, y) {
      const s = (x + y) * F2;
      const i = Math.floor(x + s), j = Math.floor(y + s);
      const t = (i + j) * G2;
      const X0 = i - t, Y0 = j - t;
      const x0 = x - X0, y0 = y - Y0;
      const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;

      const dot = (gi, x, y) => grad3[gi % 12][0] * x + grad3[gi % 12][1] * y;
      const contrib = (t, gi, x, y) => t < 0 ? 0 : (t ** 4) * dot(gi, x, y);

      const t0 = 0.5 - x0*x0 - y0*y0;
      const t1 = 0.5 - x1*x1 - y1*y1;
      const t2 = 0.5 - x2*x2 - y2*y2;

      return 70 * (
        contrib(t0, this.perm[ii + this.perm[jj]], x0, y0) +
        contrib(t1, this.perm[ii + i1 + this.perm[jj + j1]], x1, y1) +
        contrib(t2, this.perm[ii + 1 + this.perm[jj + 1]], x2, y2)
      );
    }
  };
})();

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const cgl = chottoGL(canvas, {
    extensions: ['OES_texture_float_linear', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float'],
  });
  cgl.fitWindow();

  const gl = cgl.gl;

  const canUseFloat32 = gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear');
  const floatFormat = canUseFloat32 ? gl.RGBA32F : gl.RGBA16F;
  const floatType = canUseFloat32 ? gl.FLOAT : gl.HALF_FLOAT;

  const config = {
    simResolution: 512,
    dyeResolution: 512,
    dyeDissipation: 2.3,
    pressureIterations: 20,
    splatSize: 25,
    splatForce: 50,
    displacementScale: 0.016,
    shimmerScale: 0.0,
    chromaStrength: 0.35,
    // Auto cursor settings
    autoSpeed: 0.3,
    autoScale: 0.4,
    autoNoiseScale: 0.8,
  };

  // Easing function for smooth fade transitions
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const advectionShader = cgl.createShader({ fragment: advectionFrag });
  const splatShader = cgl.createShader({ fragment: splatFrag });
  const divergenceShader = cgl.createShader({ fragment: divergenceFrag });
  const pressureShader = cgl.createShader({ fragment: pressureFrag });
  const gradientShader = cgl.createShader({ fragment: gradientFrag });
  const blurShader = cgl.createShader({ fragment: blurFrag });
  const displayShader = cgl.createShader({ fragment: displayFrag });

  const createFBO = (w, h) => {
    return cgl.createFramebuffer(w, h, null, {
      internalFormat: floatFormat,
      format: gl.RGBA,
      type: floatType,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
  };

  const createDoubleFBO = (w, h) => {
    return {
      read: createFBO(w, h),
      write: createFBO(w, h),
      swap() { [this.read, this.write] = [this.write, this.read]; }
    };
  };

  const simSize = { w: config.simResolution, h: config.simResolution };
  const dyeSize = { w: config.dyeResolution, h: config.dyeResolution };

  const velocity = createDoubleFBO(simSize.w, simSize.h);
  const pressure = createDoubleFBO(simSize.w, simSize.h);
  const divergence = createFBO(simSize.w, simSize.h);
  const dye = createDoubleFBO(dyeSize.w, dyeSize.h);

  // Placeholder 1x1 gray texture
  const createPlaceholderTexture = () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  };

  const placeholderTexture = createPlaceholderTexture();

  // Background texture management
  const bgState = {
    current: placeholderTexture,
    next: placeholderTexture,
    preloaded: null,
    fadeProgress: 0,
    isFading: false,
    timeSinceLastSwitch: 0,
    switchInterval: 10,
    fadeDuration: 2,
  };

  // Add to config
  config.switchInterval = 10;
  config.fadeDuration = 2;

  const loadingOverlay = document.createElement('div');
  loadingOverlay.style.cssText = [
    'position:fixed', 'inset:0', 'display:none',
    'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0.55)', 'color:#fff',
    'font-family:sans-serif', 'font-size:14px', 'letter-spacing:0.08em',
    'z-index:100', 'pointer-events:none',
  ].join(';');
  loadingOverlay.textContent = 'Loading image...';
  document.body.appendChild(loadingOverlay);

  const getImageUrl = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(Math.round((canvas.width || 1280) * dpr), 2560);
    const h = Math.min(Math.round((canvas.height || 720) * dpr), 1440);
    const seed = Math.floor(Math.random() * 100000);
    return `https://picsum.photos/${w}/${h}?random=${seed}`;
  };

  const loadTexture = (url) => {
    return new Promise((resolve, reject) => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);
        resolve(texture);
      };
      image.onerror = () => {
        gl.deleteTexture(texture);
        reject(new Error('Failed to load image'));
      };
      image.src = url;
    });
  };

  const deleteTextureIfNotPlaceholder = (texture) => {
    if (texture && texture !== placeholderTexture) {
      gl.deleteTexture(texture);
    }
  };

  const preloadNextImage = async () => {
    if (bgState.preloaded) return;
    try {
      bgState.preloaded = await loadTexture(getImageUrl());
    } catch (e) {
      console.error('Failed to preload image:', e);
    }
  };

  const startFadeTransition = () => {
    if (bgState.isFading || !bgState.preloaded) return;

    bgState.next = bgState.preloaded;
    bgState.preloaded = null;
    bgState.isFading = true;
    bgState.fadeProgress = 0;

    preloadNextImage();
  };

  const updateFade = (dt) => {
    if (!bgState.isFading) {
      bgState.timeSinceLastSwitch += dt;
      if (bgState.timeSinceLastSwitch >= config.switchInterval && bgState.preloaded) {
        startFadeTransition();
      }
      return;
    }

    bgState.fadeProgress += dt / config.fadeDuration;
    if (bgState.fadeProgress >= 1) {
      bgState.fadeProgress = 0;
      bgState.isFading = false;
      bgState.timeSinceLastSwitch = 0;

      const oldCurrent = bgState.current;
      bgState.current = bgState.next;
      if (oldCurrent !== bgState.next) {
        deleteTextureIfNotPlaceholder(oldCurrent);
      }
    }
  };

  const loadInitialImages = async () => {
    loadingOverlay.style.display = 'flex';
    try {
      const texture = await loadTexture(getImageUrl());
      bgState.current = texture;
      bgState.next = texture;
      preloadNextImage();
    } catch (e) {
      console.error('Failed to load initial image:', e);
    }
    loadingOverlay.style.display = 'none';
  };

  const loadRandomBgImages = async () => {
    loadingOverlay.style.display = 'flex';
    bgState.isFading = false;
    bgState.fadeProgress = 0;
    bgState.timeSinceLastSwitch = 0;

    try {
      const [tex1, tex2] = await Promise.all([
        loadTexture(getImageUrl()),
        loadTexture(getImageUrl()),
      ]);

      const oldTextures = new Set([bgState.current, bgState.next, bgState.preloaded]);
      oldTextures.forEach(tex => deleteTextureIfNotPlaceholder(tex));

      bgState.current = tex1;
      bgState.next = tex1;
      bgState.preloaded = tex2;
    } catch (e) {
      console.error('Failed to load images:', e);
    }
    loadingOverlay.style.display = 'none';
  };

  loadInitialImages();

  const pointer = new PointerInput(canvas);

  const smoothedVelocity = { x: 0, y: 0 };
  const smoothing = 0.2;
  const decay = 0.85;

  pointer.onMove(() => {
    const rawVel = pointer.getNormalizedVelocity();
    smoothedVelocity.x += (rawVel.x * 0.5 - smoothedVelocity.x) * smoothing;
    smoothedVelocity.y += (rawVel.y * 0.5 - smoothedVelocity.y) * smoothing;
  });

  // Auto cursor using simplex noise
  const noise = new SimplexNoise();
  const autoCursor = {
    x: 0.5,
    y: 0.5,
    prevX: 0.5,
    prevY: 0.5,
    time: Math.random() * 1000,
  };

  const updateAutoCursor = (dt) => {
    autoCursor.prevX = autoCursor.x;
    autoCursor.prevY = autoCursor.y;
    autoCursor.time += dt * config.autoSpeed;

    const t = autoCursor.time;
    const scale = config.autoNoiseScale;

    // Use different noise offsets for x and y to create varied movement
    const noiseX = noise.noise2D(t * scale, 0);
    const noiseY = noise.noise2D(0, t * scale + 100);

    // Map noise (-1 to 1) to screen position with padding from edges
    const padding = 0.1;
    const range = 1 - padding * 2;
    autoCursor.x = padding + (noiseX * 0.5 + 0.5) * range;
    autoCursor.y = padding + (noiseY * 0.5 + 0.5) * range;
  };

  const splat = (x, y, dx, dy) => {
    const aspect = canvas.width / canvas.height;
    const radius = config.splatSize * 0.0002;
    const force = config.splatForce;

    velocity.write.pass(splatShader, {
      uTarget: velocity.read,
      uPoint: [x, y],
      uColor: [dx * force, dy * force, 0],
      uRadius: radius,
      uAspect: aspect,
    });
    velocity.swap();

    const speed = Math.sqrt(dx * dx + dy * dy);
    dye.write.pass(splatShader, {
      uTarget: dye.read,
      uPoint: [x, y],
      uColor: [dx * force, dy * force, speed * force],
      uRadius: radius,
      uAspect: aspect,
    });
    dye.swap();
  };

  const step = (dt) => {
    const simTexel = [1 / simSize.w, 1 / simSize.h];
    const dyeTexel = [1 / dyeSize.w, 1 / dyeSize.h];

    velocity.write.pass(advectionShader, {
      uSource: velocity.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: 0.5,
      uTexelSize: simTexel,
    });
    velocity.swap();

    velocity.write.pass(blurShader, {
      uTexture: velocity.read,
      uTexelSize: simTexel,
      uDirection: [1, 0],
    });
    velocity.swap();

    velocity.write.pass(blurShader, {
      uTexture: velocity.read,
      uTexelSize: simTexel,
      uDirection: [0, 1],
    });
    velocity.swap();

    divergence.pass(divergenceShader, {
      uVelocity: velocity.read,
      uTexelSize: simTexel,
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, pressure.read.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    for (let i = 0; i < config.pressureIterations; i++) {
      pressure.write.pass(pressureShader, {
        uPressure: pressure.read,
        uDivergence: divergence,
        uTexelSize: simTexel,
      });
      pressure.swap();
    }

    velocity.write.pass(gradientShader, {
      uPressure: pressure.read,
      uVelocity: velocity.read,
      uTexelSize: simTexel,
    });
    velocity.swap();

    dye.write.pass(advectionShader, {
      uSource: dye.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.dyeDissipation,
      uTexelSize: dyeTexel,
    });
    dye.swap();
  };

  const gui = new GUI({ title: 'Fluid Gallery' });
  gui.add(config, 'dyeDissipation', 0, 5).step(0.1).name('Ripple Fade');
  gui.add(config, 'pressureIterations', 1, 50).step(1).name('Pressure Iter');
  gui.add(config, 'splatSize', 1, 30).step(1).name('Splat Size');
  gui.add(config, 'splatForce', 1, 100).name('Splat Force');
  gui.add(config, 'displacementScale', 0, 0.025).step(0.0001).name('Displacement');
  gui.add(config, 'shimmerScale', 0, 0.1).step(0.001).name('Shimmer');
  gui.add(config, 'chromaStrength', 0, 1).step(0.01).name('Chroma');

  const autoFolder = gui.addFolder('Auto Cursor');
  autoFolder.add(config, 'autoSpeed', 0.1, 1).step(0.05).name('Speed');
  autoFolder.add(config, 'autoScale', 0.1, 1).step(0.05).name('Movement Scale');
  autoFolder.add(config, 'autoNoiseScale', 0.1, 2).step(0.1).name('Noise Scale');
  autoFolder.open();

  const bgFolder = gui.addFolder('Background');
  bgFolder.add(config, 'switchInterval', 5, 30).step(1).name('Switch Interval (s)');
  bgFolder.add(config, 'fadeDuration', 0.5, 5).step(0.5).name('Fade Duration (s)');
  bgFolder.add({ loadRandom: loadRandomBgImages }, 'loadRandom').name('Load Random Images');
  bgFolder.open();

  gui.close();

  let lastTime = performance.now();

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    // Mouse input
    smoothedVelocity.x *= decay;
    smoothedVelocity.y *= decay;

    const mouseSpeed = Math.sqrt(smoothedVelocity.x ** 2 + smoothedVelocity.y ** 2);
    if (mouseSpeed > 0.0001 && pointer.isInside()) {
      const pos = pointer.getNormalizedPosition();
      const x = (pos.x + 1) * 0.5;
      const y = (pos.y + 1) * 0.5;
      splat(x, y, smoothedVelocity.x, smoothedVelocity.y);
    }

    // Auto cursor input
    updateAutoCursor(dt);
    const autoDx = (autoCursor.x - autoCursor.prevX) * config.autoScale;
    const autoDy = (autoCursor.y - autoCursor.prevY) * config.autoScale;
    const autoSpeed = Math.sqrt(autoDx * autoDx + autoDy * autoDy);
    if (autoSpeed > 0.00001) {
      splat(autoCursor.x, autoCursor.y, autoDx, autoDy);
    }

    // Update background fade
    updateFade(dt);

    step(dt);

    cgl.pass(displayShader, {
      uDye: dye.read,
      uBgImage: bgState.current,
      uBgImageNext: bgState.next,
      uFadeProgress: easeInOutCubic(bgState.fadeProgress),
      uDispScale: config.displacementScale,
      uShimmerScale: config.shimmerScale,
      uChromaStrength: config.chromaStrength,
    });

    requestAnimationFrame(render);
  };

  render();
};
