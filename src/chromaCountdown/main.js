import { chottoGL } from '../libs/esChottoGL.js';
import GUI from '../libs/gui.js';

import msdfTextFrag from './shaders/msdfText.frag?raw';
import aberrationFrag from './shaders/aberration.frag?raw';

const GLYPH_MAX = 8;
const FONT_FILE = 'inter-atlas';

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const main = async () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const cgl = chottoGL(canvas);
  const gl = cgl.gl;

  // Physical-pixel sizing so the MSDF edges stay crisp on retina displays.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const applyDPR = () => {
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  applyDPR();

  const config = {
    startValue: 10,
    interval: 1.0,
    sizeRatio: 0.7,      // glyph height as a fraction of viewport height
    textColor: '#ddd7c6',  // dusty warm off-white — muted, never bright white
    bgColor: '#0a0908',    // a touch warm too, so the contrast never reads cold
    decay: 9.0,          // how fast the tick impulse falls off
    radial: 5.0,         // % of viewport height, split growing from centre
    lateral: 2.2,        // % of viewport height, constant sideways split
    blur: 1.8,           // % of viewport height, smear on all channels
    smear: 0.85,
    tear: 0.0,           // % of viewport height, per-row glitch
    grain: 0.06,         // static luminance grain over the frame
    grainBite: 0.22,     // grain eaten into the type — the gritty part
    grainScale: 1.0,     // grain cell size in CSS px
    popScale: 0.045,     // new digit overshoots this much, then settles
    ghostOpacity: 0.42,  // previous digit lingering through the tick
    ghostDuration: 0.14,
    ghostSpread: 0.09,   // ghost scales up as it fades
  };

  const msdfShader = cgl.createShader({ fragment: msdfTextFrag });
  const aberrationShader = cgl.createShader({ fragment: aberrationFrag });

  const textFBO = cgl.createFramebuffer(canvas.width, canvas.height);

  window.addEventListener('resize', () => {
    applyDPR();
    textFBO.resize(canvas.width, canvas.height);
  });

  // --- Font atlas -----------------------------------------------------------

  const fontState = {
    atlas: null,
    atlasSize: [0, 0],
    distanceRange: 2,
    glyphs: new Map(),
    tabularAdvance: 0,
    digitTop: 0,
    digitBottom: 0,
    ready: false,
  };

  const loadFontAtlas = async () => {
    const [imgResponse, jsonResponse] = await Promise.all([
      fetch(`/fonts/${FONT_FILE}.png`),
      fetch(`/fonts/${FONT_FILE}.json`),
    ]);

    const bitmap = await createImageBitmap(await imgResponse.blob());
    const fontData = await jsonResponse.json();

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    fontState.atlas = texture;
    fontState.atlasSize = [fontData.atlas.width, fontData.atlas.height];
    fontState.distanceRange = fontData.atlas.distanceRange;

    for (const glyph of fontData.glyphs) {
      fontState.glyphs.set(String.fromCharCode(glyph.unicode), glyph);
    }

    const digits = Array.from('0123456789', (c) => fontState.glyphs.get(c)).filter(Boolean);
    // Tabular advance: every digit occupies the widest digit's cell, so the
    // countdown never shifts sideways as the number changes.
    const tab = Math.max(...digits.map((g) => g.advance));
    fontState.tabularAdvance = tab;
    fontState.digitTop = Math.max(...digits.map((g) => g.planeBounds.top));
    fontState.digitBottom = Math.min(...digits.map((g) => g.planeBounds.bottom));

    fontState.ready = true;
  };

  await loadFontAtlas();

  const digitEmHeight = fontState.digitTop - fontState.digitBottom;
  const digitEmMid = (fontState.digitTop + fontState.digitBottom) * 0.5;

  // Always two digits: 10, 09, 08 … 00.
  const formatValue = (value) => String(value).padStart(2, '0');

  // Ink extents relative to the pen origin. Centring on the ink rather than on
  // the advance box matters at display size — "10" has a narrow 1 sitting in a
  // full-width tabular cell and would otherwise read as pushed ~30px right.
  // Numbers with no 1 land within a couple of pixels of each other, so the only
  // visible shift is 10 → 09, which the tick blur covers.
  const measureInk = (text, fontSize) => {
    let cursor = 0;
    let left = Infinity;
    let right = -Infinity;

    for (const char of text) {
      const glyph = fontState.glyphs.get(char);
      if (!glyph) continue;

      const isDigit = char >= '0' && char <= '9';
      const cellAdvance = (isDigit ? fontState.tabularAdvance : glyph.advance) * fontSize;
      const xOffset = isDigit ? (cellAdvance - glyph.advance * fontSize) * 0.5 : 0;

      if (glyph.planeBounds) {
        left = Math.min(left, cursor + xOffset + glyph.planeBounds.left * fontSize);
        right = Math.max(right, cursor + xOffset + glyph.planeBounds.right * fontSize);
      }

      cursor += cellAdvance;
    }

    if (left > right) return { left: 0, width: 0 };
    return { left, width: right - left };
  };

  const prepareTextGlyphs = (text, x, y, fontSize) => {
    const bounds = [];
    const plane = [];
    const pos = [];
    let cursorX = x;

    for (const char of text) {
      const glyph = fontState.glyphs.get(char);
      if (!glyph) continue;

      const isDigit = char >= '0' && char <= '9';
      const cellAdvance = isDigit ? fontState.tabularAdvance : glyph.advance;
      const xOffset = isDigit ? (cellAdvance - glyph.advance) * fontSize * 0.5 : 0;

      if (glyph.atlasBounds && glyph.planeBounds && bounds.length < GLYPH_MAX) {
        const ab = glyph.atlasBounds;
        const pb = glyph.planeBounds;
        bounds.push(ab.left, ab.bottom, ab.right, ab.top);
        plane.push(pb.left, pb.bottom, pb.right, pb.top);
        pos.push(cursorX + xOffset, y);
      }

      cursorX += cellAdvance * fontSize;
    }

    const count = pos.length / 2;
    while (bounds.length < GLYPH_MAX * 4) bounds.push(0);
    while (plane.length < GLYPH_MAX * 4) plane.push(0);
    while (pos.length < GLYPH_MAX * 2) pos.push(0);

    return { bounds, plane, pos, count };
  };

  // --- Countdown state ------------------------------------------------------

  const state = {
    value: config.startValue,
    prev: null,
    phase: 0, // seconds since the last tick
  };

  const tick = () => {
    state.prev = state.value;
    state.value = state.value <= 0 ? config.startValue : state.value - 1;
  };

  // --- GUI ------------------------------------------------------------------

  const gui = new GUI({ title: 'Chroma Countdown' });
  const countFolder = gui.addFolder('Countdown');
  countFolder.add(config, 'startValue', 1, 30).step(1).name('Start From')
    .onChange(() => { state.value = config.startValue; state.prev = null; state.phase = 0; });
  countFolder.add(config, 'interval', 0.15, 2).step(0.05).name('Interval (s)');
  countFolder.open();

  const typeFolder = gui.addFolder('Type');
  typeFolder.add(config, 'sizeRatio', 0.2, 0.95).step(0.01).name('Size (of height)');
  typeFolder.addColor(config, 'textColor').name('Text');
  typeFolder.addColor(config, 'bgColor').name('Background');
  typeFolder.add(config, 'grain', 0, 0.25).step(0.005).name('Grain');
  typeFolder.add(config, 'grainBite', 0, 0.6).step(0.01).name('Grain Bite');
  typeFolder.add(config, 'grainScale', 0.5, 6).step(0.5).name('Grain Size (px)');
  typeFolder.open();

  const glitchFolder = gui.addFolder('Tick Glitch');
  glitchFolder.add(config, 'decay', 2, 25).step(0.5).name('Decay');
  glitchFolder.add(config, 'radial', 0, 15).step(0.1).name('Radial Split');
  glitchFolder.add(config, 'lateral', 0, 10).step(0.1).name('Lateral Split');
  glitchFolder.add(config, 'blur', 0, 8).step(0.1).name('Blur');
  glitchFolder.add(config, 'smear', 0, 1).step(0.01).name('Smear');
  glitchFolder.add(config, 'tear', 0, 4).step(0.05).name('Tear');
  glitchFolder.add(config, 'popScale', 0, 0.2).step(0.005).name('Scale Pop');
  glitchFolder.add(config, 'ghostOpacity', 0, 1).step(0.01).name('Ghost');
  glitchFolder.add(config, 'ghostDuration', 0.02, 0.5).step(0.01).name('Ghost Time');
  glitchFolder.add(config, 'ghostSpread', 0, 0.4).step(0.01).name('Ghost Spread');
  glitchFolder.open();

  gui.close();

  // --- Render ---------------------------------------------------------------

  let lastTime = performance.now();
  let elapsed = 0;

  const drawText = (text, fontSize, alpha) => {
    const ink = measureInk(text, fontSize);
    const x = (canvas.width - ink.width) * 0.5 - ink.left;
    // Baseline chosen so the digit box straddles the vertical centre.
    const y = canvas.height * 0.5 + digitEmMid * fontSize;

    const { bounds, plane, pos, count } = prepareTextGlyphs(text, x, y, fontSize);
    if (count === 0) return;

    textFBO.pass(msdfShader, {
      uAtlas: fontState.atlas,
      uGlyphBounds: bounds,
      uGlyphPlane: plane,
      uGlyphPos: pos,
      uGlyphCount: count,
      uResolution: [canvas.width, canvas.height],
      uAtlasSize: fontState.atlasSize,
      uFontSize: fontSize,
      uDistanceRange: fontState.distanceRange,
      uAlpha: alpha,
    });
  };

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 20);
    lastTime = now;
    elapsed += dt;

    state.phase += dt;
    while (state.phase >= config.interval) {
      state.phase -= config.interval;
      tick();
    }

    const impulse = Math.exp(-state.phase * config.decay);

    // Base font size: glyph height = sizeRatio of the viewport, then clamped by
    // the widest number in the sequence so the size never changes mid-countdown.
    let fontSize = (config.sizeRatio * canvas.height) / digitEmHeight;
    // Clamp on the widest number in the sequence — an all-8s string of the same
    // digit count — so the size never changes mid-countdown.
    const inkWidth = measureInk('8'.repeat(formatValue(config.startValue).length), fontSize).width;
    const maxWidth = canvas.width * 0.92;
    if (inkWidth > maxWidth) fontSize *= maxWidth / inkWidth;

    // Coverage buffer: ghost of the outgoing digit, then the incoming digit.
    // MAX blending keeps the union of both without darkening the overlap.
    textFBO.clear(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);

    const ghostP = state.phase / config.ghostDuration;
    if (state.prev !== null && ghostP < 1) {
      const fade = Math.pow(1 - ghostP, 1.6);
      drawText(
        formatValue(state.prev),
        fontSize * (1 + config.ghostSpread * ghostP),
        config.ghostOpacity * fade
      );
    }

    drawText(formatValue(state.value), fontSize * (1 + config.popScale * impulse), 1);

    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);

    const unit = canvas.height * 0.01; // sliders are in % of viewport height
    cgl.pass(aberrationShader, {
      uText: textFBO,
      uResolution: [canvas.width, canvas.height],
      uBgColor: hexToRgb(config.bgColor),
      uTextColor: hexToRgb(config.textColor),
      uAmount: impulse,
      uRadial: config.radial * unit,
      uLateral: config.lateral * unit,
      uBlur: config.blur * unit,
      uSmear: config.smear,
      uTear: config.tear * unit,
      uGrain: config.grain,
      uGrainBite: config.grainBite,
      uGrainScale: config.grainScale * dpr, // keep the grain the same visual size on retina
      uTime: elapsed,
    });

    requestAnimationFrame(render);
  };

  render();
};
