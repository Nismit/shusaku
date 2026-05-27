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
import msdfTextFrag from './shaders/msdfText.frag?raw';

// Simplex noise for smooth auto cursor movement
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

// Local video files - resolution selected based on screen size
const VIDEO_BASE_NAMES = ['video1', 'video2', 'video3', 'video4'];

const getVideoUrls = () => {
  const is4K = window.innerWidth > 1920 || window.innerHeight > 1080;
  const suffix = is4K ? '-4k.mp4' : '-1080p.mp4';
  return VIDEO_BASE_NAMES.map(name => `/videos/${name}${suffix}`);
};

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
    dyeDissipation: 1.8,
    pressureIterations: 20,
    splatSize: 25,
    splatForce: 70,
    displacementScale: 0.025,
    chromaStrength: 0.35,
    autoSpeed: 0.35,
    autoScale: 0.5,
    autoNoiseScale: 0.8,
    switchInterval: 15,
    fadeDuration: 3,
    overlayOpacity: 0.5,
    fontSize: 180,
    textPadding: 40,
    showSeconds: true,
    verticalLayout: false,
    fontFamily: 'inter',
    textPosition: 'middle-center',
    textColor: '#ffffff',
    textOpacity: 0.9,
  };

  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const advectionShader = cgl.createShader({ fragment: advectionFrag });
  const splatShader = cgl.createShader({ fragment: splatFrag });
  const divergenceShader = cgl.createShader({ fragment: divergenceFrag });
  const pressureShader = cgl.createShader({ fragment: pressureFrag });
  const gradientShader = cgl.createShader({ fragment: gradientFrag });
  const blurShader = cgl.createShader({ fragment: blurFrag });
  const displayShader = cgl.createShader({ fragment: displayFrag });
  const msdfTextShader = cgl.createShader({ fragment: msdfTextFrag });

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

  // 1x1 gray placeholder texture
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

  // Shuffled video URL queue — refills when empty
  let videoQueue = [];
  let videoUrls = getVideoUrls();
  const getNextVideoUrl = () => {
    if (!videoQueue.length) {
      videoQueue = [...videoUrls].sort(() => Math.random() - 0.5);
    }
    return videoQueue.pop();
  };

  // Create a video texture entry from a URL.
  // Resolves when the video has enough data to begin playing.
  const loadVideo = (url) => new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.src = url;
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.crossOrigin = 'anonymous';

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    el.addEventListener('canplay', () => {
      el.play().catch(() => {});
      const aspect = el.videoWidth > 0 ? el.videoWidth / el.videoHeight : 16 / 9;
      resolve({ el, texture, aspect });
    }, { once: true });

    el.addEventListener('error', () => {
      gl.deleteTexture(texture);
      reject(new Error(`Failed to load video: ${url}`));
    }, { once: true });

    el.load();
  });

  // Stop playback, release GPU texture, and null out the video element
  const destroyVideo = (entry) => {
    if (!entry || entry.texture === placeholderTexture) return;
    if (entry.el) {
      entry.el.pause();
      entry.el.src = '';
    }
    gl.deleteTexture(entry.texture);
  };

  // Upload the current video frame to its GPU texture
  const uploadVideoFrame = (entry) => {
    if (!entry.el || entry.el.readyState < 2) return;
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.el);
    gl.bindTexture(gl.TEXTURE_2D, null);
  };

  // Video fade state (mirrors bgState in image version)
  const videoState = {
    current: { el: null, texture: placeholderTexture, aspect: 16 / 9 },
    next:    { el: null, texture: placeholderTexture, aspect: 16 / 9 },
    preloading: null,
    fadeProgress: 0,
    isFading: false,
    timeSinceLastSwitch: 0,
  };

  const loadingOverlay = document.createElement('div');
  loadingOverlay.style.cssText = [
    'position:fixed', 'inset:0', 'display:none',
    'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0.55)', 'color:#fff',
    'font-family:sans-serif', 'font-size:14px', 'letter-spacing:0.08em',
    'z-index:100', 'pointer-events:none',
  ].join(';');
  loadingOverlay.textContent = 'Loading video...';
  document.body.appendChild(loadingOverlay);

  const preloadNextVideo = async () => {
    if (videoState.preloading) return;
    try {
      videoState.preloading = await loadVideo(getNextVideoUrl());
    } catch (e) {
      console.error('Failed to preload video:', e);
      videoState.preloading = null;
    }
  };

  const startFadeTransition = () => {
    if (videoState.isFading || !videoState.preloading) return;

    videoState.next = videoState.preloading;
    videoState.preloading = null;
    videoState.isFading = true;
    videoState.fadeProgress = 0;

    preloadNextVideo();
  };

  const updateFade = (dt) => {
    if (!videoState.isFading) {
      videoState.timeSinceLastSwitch += dt;
      if (videoState.timeSinceLastSwitch >= config.switchInterval && videoState.preloading) {
        startFadeTransition();
      }
      return;
    }

    videoState.fadeProgress += dt / config.fadeDuration;
    if (videoState.fadeProgress >= 1) {
      videoState.fadeProgress = 0;
      videoState.isFading = false;
      videoState.timeSinceLastSwitch = 0;

      const old = videoState.current;
      videoState.current = videoState.next;
      if (old !== videoState.next) {
        destroyVideo(old);
      }
    }
  };

  const loadInitialVideo = async () => {
    loadingOverlay.style.display = 'flex';
    try {
      const entry = await loadVideo(getNextVideoUrl());
      videoState.current = entry;
      videoState.next = entry;
      preloadNextVideo();
    } catch (e) {
      console.error('Failed to load initial video:', e);
    }
    loadingOverlay.style.display = 'none';
  };

  const loadRandomVideos = async () => {
    loadingOverlay.style.display = 'flex';
    videoState.isFading = false;
    videoState.fadeProgress = 0;
    videoState.timeSinceLastSwitch = 0;

    try {
      const [entry1, entry2] = await Promise.all([
        loadVideo(getNextVideoUrl()),
        loadVideo(getNextVideoUrl()),
      ]);

      const oldEntries = [videoState.current, videoState.next, videoState.preloading];
      oldEntries.forEach(e => {
        if (e && e !== entry1 && e !== entry2) destroyVideo(e);
      });

      videoState.current = entry1;
      videoState.next = entry1;
      videoState.preloading = entry2;
    } catch (e) {
      console.error('Failed to load videos:', e);
    }
    loadingOverlay.style.display = 'none';
  };

  loadInitialVideo();

  // --- URL param helpers ---
  const loadFromUrl = () => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('font'))  config.fontFamily     = p.get('font');
    if (p.has('fs'))    config.fontSize        = Number(p.get('fs'));
    if (p.has('pos'))   config.textPosition    = p.get('pos');
    if (p.has('color')) config.textColor       = p.get('color'); // already a hex string
    if (p.has('op'))    config.textOpacity     = Number(p.get('op'));
    if (p.has('over'))  config.overlayOpacity  = Number(p.get('over'));
    if (p.has('secs'))  config.showSeconds     = p.get('secs') !== '0';
    if (p.has('vert'))  config.verticalLayout  = p.get('vert') === '1';
    return p.has('pub');
  };

  const buildPublishUrl = () => {
    const p = new URLSearchParams({
      font:  config.fontFamily,
      fs:    config.fontSize,
      pos:   config.textPosition,
      color: config.textColor, // hex string, no conversion needed
      op:    config.textOpacity,
      over:  config.overlayOpacity,
      secs:  config.showSeconds ? '1' : '0',
      vert:  config.verticalLayout ? '1' : '0',
      pub:   '1',
    });
    return `${location.origin}${location.pathname}?${p}`;
  };

  // --- Font atlas loading
  const FONT_OPTIONS = {
    'inter': { name: 'Inter', file: 'inter-atlas' },
    'bebas-neue': { name: 'Bebas Neue', file: 'bebas-neue-atlas' },
    'orbitron': { name: 'Orbitron', file: 'orbitron-atlas' },
    'oswald': { name: 'Oswald', file: 'oswald-atlas' },
  };

  const fontState = {
    atlas: null,
    glyphs: new Map(),
    atlasSize: [220, 220],
    tabularAdvance: 0,
    ready: false,
    currentFont: null,
  };

  const loadFontAtlas = async (fontKey) => {
    const fontInfo = FONT_OPTIONS[fontKey];
    if (!fontInfo || fontState.currentFont === fontKey) return;

    fontState.ready = false;

    try {
      const [imgResponse, jsonResponse] = await Promise.all([
        fetch(`/fonts/${fontInfo.file}.png`),
        fetch(`/fonts/${fontInfo.file}.json`),
      ]);

      const imgBlob = await imgResponse.blob();
      const imgBitmap = await createImageBitmap(imgBlob);
      const fontData = await jsonResponse.json();

      if (fontState.atlas) {
        gl.deleteTexture(fontState.atlas);
      }

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgBitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);

      fontState.atlas = texture;
      fontState.atlasSize = [fontData.atlas.width, fontData.atlas.height];
      fontState.glyphs.clear();

      for (const glyph of fontData.glyphs) {
        fontState.glyphs.set(String.fromCharCode(glyph.unicode), glyph);
      }

      // Compute tabular advance: max digit width so all 0-9 share the same advance
      fontState.tabularAdvance = Math.max(
        ...Array.from('0123456789', c => fontState.glyphs.get(c)?.advance ?? 0)
      );

      fontState.currentFont = fontKey;
      fontState.ready = true;
    } catch (e) {
      console.error('Failed to load font atlas:', e);
    }
  };

  loadFontAtlas(config.fontFamily);

  const getTimeComponents = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return { h, m, s };
  };

  const getTimeString = () => {
    const { h, m, s } = getTimeComponents();
    return config.showSeconds ? `${h}:${m}:${s}` : `${h}:${m}`;
  };

  const measureTextWidth = (text, fontSize) => {
    let width = 0;
    for (const char of text) {
      const glyph = fontState.glyphs.get(char);
      if (!glyph) continue;
      const isDigit = char >= '0' && char <= '9';
      const cellAdvance = isDigit && fontState.tabularAdvance > 0
        ? fontState.tabularAdvance
        : glyph.advance;
      width += cellAdvance * fontSize;
    }
    return width;
  };

  // 9-grid layout: returns pixel {x, y} anchor for the given text width
  const getTextLayout = (textWidth, fontSize) => {
    const pad = config.textPadding;
    const [vPart, hPart] = config.textPosition.split('-');

    let x;
    if (hPart === 'left')   x = pad;
    else if (hPart === 'right')  x = canvas.width - textWidth - pad;
    else                         x = (canvas.width - textWidth) / 2; // center

    let y;
    if (vPart === 'top')    y = pad + fontSize * 0.9;
    else if (vPart === 'bottom') y = canvas.height - pad;
    else                         y = canvas.height / 2 + fontSize * 0.35; // middle

    // Y clamp — prevent clipping at top/bottom regardless of font size
    y = Math.max(fontSize * 0.9, Math.min(canvas.height - pad, y));

    return { x, y };
  };

  const prepareTextGlyphs = (text, x, y, fontSize) => {
    const glyphBounds = [];
    const glyphPlane = [];
    const glyphPos = [];
    let cursorX = x;
    const isDigit = (c) => c >= '0' && c <= '9';

    for (const char of text) {
      const glyph = fontState.glyphs.get(char);
      if (!glyph) continue;

      const tabular = isDigit(char) && fontState.tabularAdvance > 0;
      const cellAdvance = tabular ? fontState.tabularAdvance : glyph.advance;
      // Center the glyph within its tabular cell
      const xOffset = tabular ? (cellAdvance - glyph.advance) * fontSize * 0.5 : 0;

      if (glyph.atlasBounds && glyph.planeBounds) {
        const ab = glyph.atlasBounds;
        const pb = glyph.planeBounds;
        glyphBounds.push([ab.left, ab.bottom, ab.right, ab.top]);
        glyphPlane.push([pb.left, pb.bottom, pb.right, pb.top]);
        glyphPos.push([cursorX + xOffset, y]);
      }

      cursorX += cellAdvance * fontSize;
    }

    return { glyphBounds, glyphPlane, glyphPos };
  };

  const pointer = new PointerInput(canvas);

  const smoothedVelocity = { x: 0, y: 0 };
  const smoothing = 0.2;
  const decay = 0.85;

  pointer.onMove(() => {
    const rawVel = pointer.getNormalizedVelocity();
    smoothedVelocity.x += (rawVel.x * 0.5 - smoothedVelocity.x) * smoothing;
    smoothedVelocity.y += (rawVel.y * 0.5 - smoothedVelocity.y) * smoothing;
  });

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
    const noiseX = noise.noise2D(t * scale, 0);
    const noiseY = noise.noise2D(0, t * scale + 100);

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

  const gui = new GUI({ title: 'Ambient Clock' });
  gui.add(config, 'dyeDissipation', 0, 5).step(0.1).name('Ripple Fade');
  gui.add(config, 'pressureIterations', 1, 50).step(1).name('Pressure Iter');
  gui.add(config, 'splatSize', 1, 30).step(1).name('Splat Size');
  gui.add(config, 'splatForce', 1, 100).name('Splat Force');
  gui.add(config, 'displacementScale', 0, 0.025).step(0.0001).name('Displacement');
  gui.add(config, 'chromaStrength', 0, 1).step(0.01).name('Chroma');

  const autoFolder = gui.addFolder('Auto Cursor');
  autoFolder.add(config, 'autoSpeed', 0.1, 1).step(0.05).name('Speed');
  autoFolder.add(config, 'autoScale', 0.1, 1).step(0.05).name('Movement Scale');
  autoFolder.add(config, 'autoNoiseScale', 0.1, 2).step(0.1).name('Noise Scale');
  autoFolder.open();

  const bgFolder = gui.addFolder('Background');
  bgFolder.add(config, 'switchInterval', 5, 60).step(1).name('Switch Interval (s)');
  bgFolder.add(config, 'fadeDuration', 0.5, 8).step(0.5).name('Fade Duration (s)');
  bgFolder.add({ loadRandom: loadRandomVideos }, 'loadRandom').name('Load Random Videos');
  bgFolder.open();

  const screenSaverFolder = gui.addFolder('Screensaver');
  screenSaverFolder.add(config, 'overlayOpacity', 0, 0.8).step(0.05).name('Overlay Opacity');
  screenSaverFolder.add(config, 'fontSize', 24, 300).step(4).name('Font Size');
  screenSaverFolder.add(config, 'showSeconds').name('Show Seconds');
  screenSaverFolder.add(config, 'verticalLayout').name('Vertical Layout');
  screenSaverFolder.add(config, 'textPosition', {
    '↖ Top Left':      'top-left',
    '↑ Top Center':    'top-center',
    '↗ Top Right':     'top-right',
    '← Middle Left':   'middle-left',
    '⊙ Middle Center': 'middle-center',
    '→ Middle Right':  'middle-right',
    '↙ Bottom Left':   'bottom-left',
    '↓ Bottom Center': 'bottom-center',
    '↘ Bottom Right':  'bottom-right',
  }).name('Position');
  screenSaverFolder.addColor(config, 'textColor').name('Text Color');
  screenSaverFolder.add(config, 'textOpacity', 0, 1).step(0.01).name('Text Opacity');
  screenSaverFolder.add(config, 'fontFamily', {
    'Inter': 'inter',
    'Bebas Neue': 'bebas-neue',
    'Orbitron': 'orbitron',
    'Oswald': 'oswald',
  }).name('Font').onChange((value) => loadFontAtlas(value));
  screenSaverFolder.open();

  const publishObj = {
    copy: () => {
      const url = buildPublishUrl();
      navigator.clipboard.writeText(url).catch(() => {});
      const ctrl = gui.controllersRecursive().find(c => c.property === 'copy');
      if (ctrl) {
        ctrl.name('Copied ✓');
        setTimeout(() => ctrl.name('📋 Copy Publish URL'), 2000);
      }
    },
  };
  gui.add(publishObj, 'copy').name('📋 Copy Publish URL');

  const isPublished = loadFromUrl();
  // Font (and other config) may have changed via URL params — always resync
  loadFontAtlas(config.fontFamily);
  if (isPublished) gui.hide();

  gui.close();

  let lastTime = performance.now();

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    // Upload current video frames to GPU textures
    uploadVideoFrame(videoState.current);
    if (videoState.isFading) uploadVideoFrame(videoState.next);

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

    updateFade(dt);
    step(dt);

    cgl.pass(displayShader, {
      uDye: dye.read,
      uBgImage: videoState.current.texture,
      uBgImageNext: videoState.next.texture,
      uFadeProgress: easeInOutCubic(videoState.fadeProgress),
      uDispScale: config.displacementScale,
      uChromaStrength: config.chromaStrength,
      uOverlayOpacity: config.overlayOpacity,
      uVideoAspect: videoState.current.aspect ?? 16 / 9,
      uVideoAspectNext: videoState.next.aspect ?? 16 / 9,
      uCanvasAspect: canvas.width / canvas.height,
    });

    // Render time text
    if (fontState.ready) {
      const fontSize = config.fontSize;
      const { h, m, s } = getTimeComponents();
      // Parse hex string '#rrggbb' → [r, g, b, a] in 0-1 range
      const hexN = parseInt(config.textColor.replace('#', ''), 16);
      const textColor = [
        ((hexN >> 16) & 255) / 255,
        ((hexN >>  8) & 255) / 255,
        ( hexN        & 255) / 255,
        config.textOpacity,
      ];

      const renderTextLine = (text, x, y) => {
        const { glyphBounds, glyphPlane, glyphPos } = prepareTextGlyphs(text, x, y, fontSize);
        if (glyphBounds.length === 0) return;

        const flatBounds = glyphBounds.flat();
        const flatPlane = glyphPlane.flat();
        const flatPos = glyphPos.flat();

        while (flatBounds.length < 64) flatBounds.push(0);
        while (flatPlane.length < 64) flatPlane.push(0);
        while (flatPos.length < 32) flatPos.push(0);

        cgl.pass(msdfTextShader, {
          uAtlas: fontState.atlas,
          uGlyphBounds: flatBounds,
          uGlyphPlane: flatPlane,
          uGlyphPos: flatPos,
          uGlyphCount: glyphBounds.length,
          uResolution: [canvas.width, canvas.height],
          uFontSize: fontSize,
          uColor: textColor,
          uAtlasSize: fontState.atlasSize,
        });
      };

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (config.verticalLayout) {
        const lines = config.showSeconds ? [h, m, s] : [h, m];
        const lineHeight = fontSize * 1.1;
        // Use Y from a representative width=0 call; X per-line from actual width
        const { y: centerY } = getTextLayout(0, fontSize);

        lines.forEach((line, i) => {
          const w = measureTextWidth(line, fontSize);
          const { x } = getTextLayout(w, fontSize);
          const offsetY = (i - (lines.length - 1) / 2) * lineHeight;
          renderTextLine(line, x, centerY + offsetY);
        });
      } else {
        const timeStr = config.showSeconds ? `${h}:${m}:${s}` : `${h}:${m}`;
        const textWidth = measureTextWidth(timeStr, fontSize);
        const { x: textX, y: textY } = getTextLayout(textWidth, fontSize);
        renderTextLine(timeStr, textX, textY);
      }

      gl.disable(gl.BLEND);
    }

    requestAnimationFrame(render);
  };

  render();
};
