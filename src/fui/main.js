import { chottoGL } from '../libs/esChottoGL.js';
import { MultiTouchInput } from './MultiTouchInput.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import msdfTextFrag from './shaders/msdfText.frag?raw';
import cursorFrag from './shaders/cursor.frag?raw';
import gaugeFrag from './shaders/gauge.frag?raw';

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const cgl = chottoGL(canvas);
  const gl = cgl.gl;

  // DPR-aware sizing
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const applySize = () => {
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  applySize();
  window.addEventListener('resize', applySize);

  const msdfTextShader = cgl.createShader({ fragment: msdfTextFrag });
  const cursorShader = cgl.createShader({ fragment: cursorFrag });
  const gaugeShader = cgl.createShader({ fragment: gaugeFrag });

  const fpsGraph = new FPSGraph();

  // Font state
  const fontState = {
    atlas: null,
    glyphs: new Map(),
    atlasSize: [512, 512],
    tabularAdvance: 0,
    ready: false,
  };

  const loadFontAtlas = async () => {
    try {
      const [imgResponse, jsonResponse] = await Promise.all([
        fetch('/fonts/orbitron-atlas.png'),
        fetch('/fonts/orbitron-atlas.json'),
      ]);

      const imgBlob = await imgResponse.blob();
      const imgBitmap = await createImageBitmap(imgBlob);
      const fontData = await jsonResponse.json();

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

      fontState.tabularAdvance = Math.max(
        ...Array.from('0123456789', c => fontState.glyphs.get(c)?.advance ?? 0)
      );

      fontState.ready = true;
    } catch (e) {
      console.error('Failed to load font atlas:', e);
    }
  };

  loadFontAtlas();

  // Input
  const input = new MultiTouchInput(canvas);

  // Device sensors
  const sensors = {
    permission: 'unknown', // 'unknown', 'granted', 'denied', 'unavailable'
    orientation: { alpha: 0, beta: 0, gamma: 0 },
    motion: { x: 0, y: 0, z: 0 },
    rotationRate: { alpha: 0, beta: 0, gamma: 0 },
  };

  const needsPermission = () => {
    return typeof DeviceOrientationEvent !== 'undefined' &&
           typeof DeviceOrientationEvent.requestPermission === 'function';
  };

  const setupSensorListeners = () => {
    window.addEventListener('deviceorientation', (e) => {
      sensors.orientation.alpha = e.alpha || 0;
      sensors.orientation.beta = e.beta || 0;
      sensors.orientation.gamma = e.gamma || 0;
    });

    window.addEventListener('devicemotion', (e) => {
      const accel = e.accelerationIncludingGravity || {};
      sensors.motion.x = accel.x || 0;
      sensors.motion.y = accel.y || 0;
      sensors.motion.z = accel.z || 0;

      const rot = e.rotationRate || {};
      sensors.rotationRate.alpha = rot.alpha || 0;
      sensors.rotationRate.beta = rot.beta || 0;
      sensors.rotationRate.gamma = rot.gamma || 0;
    });
  };

  const requestSensorPermission = async () => {
    if (!needsPermission()) {
      sensors.permission = 'granted';
      setupSensorListeners();
      return;
    }

    try {
      const orientationPerm = await DeviceOrientationEvent.requestPermission();
      const motionPerm = await DeviceMotionEvent.requestPermission();

      if (orientationPerm === 'granted' && motionPerm === 'granted') {
        sensors.permission = 'granted';
        setupSensorListeners();
      } else {
        sensors.permission = 'denied';
      }
    } catch (e) {
      sensors.permission = 'denied';
      console.error('Sensor permission error:', e);
    }
  };

  // Check if sensors are available without permission (non-iOS)
  if (!needsPermission()) {
    if ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window) {
      sensors.permission = 'granted';
      setupSensorListeners();
    } else {
      sensors.permission = 'unavailable';
    }
  }

  // Permission button overlay
  const createPermissionOverlay = () => {
    const overlay = document.createElement('div');
    overlay.id = 'sensor-permission-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.85);
      z-index: 100;
    `;

    const button = document.createElement('button');
    button.textContent = 'ENABLE SENSORS';
    button.style.cssText = `
      padding: 20px 40px;
      font-family: 'Orbitron', sans-serif;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: 0.15em;
      color: #000000;
      background: transparent;
      border: 1px solid #000000;
      cursor: pointer;
      transition: all 0.3s ease;
    `;
    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(0, 0, 0, 0.05)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'transparent';
    });
    button.addEventListener('click', async () => {
      await requestSensorPermission();
      overlay.remove();
    });

    overlay.appendChild(button);
    document.body.appendChild(overlay);
  };

  // Show permission overlay if needed (iOS)
  if (needsPermission()) {
    createPermissionOverlay();
  }

  // Stats
  let frameCount = 0;

  // Text rendering helpers
  const measureTextWidth = (text, fontSize) => {
    let width = 0;
    for (const char of text) {
      const glyph = fontState.glyphs.get(char);
      if (!glyph) continue;
      const isDigit = char >= '0' && char <= '9';
      width += (isDigit && fontState.tabularAdvance > 0 ? fontState.tabularAdvance : glyph.advance) * fontSize;
    }
    return width;
  };

  const prepareTextGlyphs = (text, x, y, fontSize) => {
    const glyphBounds = [];
    const glyphPlane = [];
    const glyphPos = [];
    let cursorX = x;

    for (const char of text) {
      const glyph = fontState.glyphs.get(char);
      if (!glyph) continue;

      const isDigit = char >= '0' && char <= '9';
      const tabular = isDigit && fontState.tabularAdvance > 0;
      const cellAdvance = tabular ? fontState.tabularAdvance : glyph.advance;
      const xOffset = tabular ? (cellAdvance - glyph.advance) * fontSize * 0.5 : 0;

      if (glyph.atlasBounds && glyph.planeBounds) {
        if (glyphBounds.length >= 32) break;
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

  const renderText = (text, x, y, fontSize, color = [1, 1, 1, 1]) => {
    const { glyphBounds, glyphPlane, glyphPos } = prepareTextGlyphs(text, x, y, fontSize);
    if (glyphBounds.length === 0) return;

    const flatBounds = glyphBounds.flat();
    const flatPlane = glyphPlane.flat();
    const flatPos = glyphPos.flat();

    while (flatBounds.length < 128) flatBounds.push(0);
    while (flatPlane.length < 128) flatPlane.push(0);
    while (flatPos.length < 64) flatPos.push(0);

    cgl.pass(msdfTextShader, {
      uAtlas: fontState.atlas,
      uGlyphBounds: flatBounds,
      uGlyphPlane: flatPlane,
      uGlyphPos: flatPos,
      uGlyphCount: glyphBounds.length,
      uResolution: [canvas.width, canvas.height],
      uFontSize: fontSize,
      uColor: color,
      uAtlasSize: fontState.atlasSize,
    });
  };

  // Format number with fixed decimals
  const fmt = (n, decimals = 2) => {
    const sign = n < 0 ? '-' : ' ';
    const abs = Math.abs(n).toFixed(decimals);
    return sign + abs.padStart(decimals + 2, ' ');
  };

  const render = () => {
    const now = performance.now();
    frameCount++;
    fpsGraph.tick();

    cgl.clear(1.0, 1.0, 1.0, 1.0);

    if (!fontState.ready) {
      requestAnimationFrame(render);
      return;
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const baseFontSize = Math.min(canvas.width, canvas.height) * 0.03;
    const lineHeight = baseFontSize * 1.4;
    const frameMarginPx = 24 * dpr;
    const frameArmPx = 40 * dpr;
    const padding = frameMarginPx + frameArmPx * 0.4;
    let y = padding + baseFontSize;

    const primary = [0, 0, 0, 0.9];
    const accent = [0, 0, 0, 0.7];
    const dim = [0, 0, 0, 0.4];

    // System info
    const elapsed = (now / 1000).toFixed(2);
    renderText(`TIME ${elapsed}s`, padding, y, baseFontSize, primary);
    y += lineHeight;

    // Resolution / frame count (top-right)
    {
      const smallFont = baseFontSize * 0.6;
      const fText = `F ${frameCount}`;
      const resText = `${canvas.width}x${canvas.height}`;
      const infoX = canvas.width - padding;
      const infoY = padding + smallFont;
      renderText(resText, infoX - measureTextWidth(resText, smallFont), infoY, smallFont, dim);
      renderText(fText, infoX - measureTextWidth(fText, smallFont), infoY + lineHeight * 0.7, smallFont, dim);
    }

    // Pointer info
    const pointers = input.getPointers();
    const count = pointers.length;

    renderText(`POINTERS ${count}`, padding, y, baseFontSize, accent);
    y += lineHeight;

    // Display each pointer
    for (let i = 0; i < pointers.length && i < 5; i++) {
      const p = pointers[i];
      const id = p.id === -1 ? 'M' : p.id.toString();

      renderText(`P${id}`, padding, y, baseFontSize * 0.8, dim);

      const posText = `X${fmt(p.normalizedX)} Y${fmt(p.normalizedY)}`;
      renderText(posText, padding + baseFontSize * 3, y, baseFontSize * 0.8, primary);

      const speed = Math.sqrt(p.normalizedVelocityX ** 2 + p.normalizedVelocityY ** 2);
      const velText = `V${fmt(speed, 3)}`;
      renderText(velText, padding + baseFontSize * 14, y, baseFontSize * 0.8, dim);

      y += lineHeight * 0.9;
    }

    // Two-pointer metrics
    if (count >= 2) {
      y += lineHeight * 0.5;
      const [p1, p2] = pointers;
      const dist = input.getDistance(p1, p2);
      const angle = input.getAngle(p1, p2) * (180 / Math.PI);

      renderText(`DIST ${fmt(dist, 3)}`, padding, y, baseFontSize * 0.8, accent);
      y += lineHeight * 0.9;

      renderText(`ANGLE ${fmt(angle, 1)}`, padding, y, baseFontSize * 0.8, accent);
      y += lineHeight * 0.9;
    }

    // Three-pointer metrics
    if (count >= 3) {
      const [p1, p2, p3] = pointers;
      const area = input.getTriangleArea(p1, p2, p3);
      const centroid = input.getCentroid();

      renderText(`AREA ${fmt(area, 4)}`, padding, y, baseFontSize * 0.8, accent);
      y += lineHeight * 0.9;

      renderText(`CENTER X${fmt(centroid.x)} Y${fmt(centroid.y)}`, padding, y, baseFontSize * 0.8, accent);
      y += lineHeight * 0.9;
    }

    // Device sensors (disabled)
    // if (sensors.permission === 'granted') { ... }

    // Gauges (bottom-right)
    {
      const gaugeW = 120 * dpr;
      const gaugeH = 8 * dpr;
      const gaugeX = canvas.width - padding - gaugeW;
      const gaugeY = canvas.height - padding - gaugeH;
      const progress = (now % 10000) / 10000;

      cgl.pass(gaugeShader, {
        uResolution: [canvas.width, canvas.height],
        uRect: [gaugeX, gaugeY, gaugeW, gaugeH],
        uProgress: progress,
        uBorderWidth: 1.0 * dpr,
        uBorderColor: [0, 0, 0, 0.8],
        uFillColor: [0, 0, 0, 0.8],
        uBgColor: [0, 0, 0, 0.0],
      });
    }

    // Cursor / touch overlay
    {
      const idleThreshold = 2000;
      const fadeDuration = 1000;
      const touchFadeIn = 150;

      let mouseOpacity = 0;
      if (input.mouseInside) {
        const idle = now - input.lastMoveTime;
        mouseOpacity = idle < idleThreshold
          ? 1.0
          : 1.0 - Math.min((idle - idleThreshold) / fadeDuration, 1.0);
      }

      const touchPointers = input.getPointers().filter(p => p.id !== -1);
      const touchCount = Math.min(touchPointers.length, 5);
      const touchPos = new Float32Array(10);
      const touchOpacity = new Float32Array(5);

      for (let i = 0; i < touchCount; i++) {
        const p = touchPointers[i];
        touchPos[i * 2] = p.pixelX * dpr;
        touchPos[i * 2 + 1] = p.pixelY * dpr;
        touchOpacity[i] = Math.min((now - p.startTime) / touchFadeIn, 1.0);
      }

      {
        const bracketHalf = 30 * dpr;
        cgl.pass(cursorShader, {
          uResolution: [canvas.width, canvas.height],
          uMousePos: [input.mousePixelX * dpr, input.mousePixelY * dpr],
          uMouseOpacity: mouseOpacity,
          uBracketHalf: bracketHalf,
          uCornerLen: 10 * dpr,
          uFrameMargin: 24 * dpr,
          uFrameCornerLen: 40 * dpr,
          uFrameOpacity: 1.0,
          uTouchPos: touchPos,
          uTouchOpacity: touchOpacity,
          uTouchCount: touchCount,
          uCircleRadius: 30 * dpr,
          uThickness: 1.5 * dpr,
          uColor: [0, 0, 0, 0.8],
        });

        if (mouseOpacity > 0.001) {
          const coordFont = baseFontSize * 0.35;
          const mx = input.mousePixelX * dpr;
          const my = input.mousePixelY * dpr;
          const nx = ((input.mousePixelX / (canvas.width / dpr)) * 2 - 1).toFixed(2);
          const ny = (-(input.mousePixelY / (canvas.height / dpr)) * 2 + 1).toFixed(2);
          const coordColor = [0, 0, 0, 0.6 * mouseOpacity];
          const rightEdge = mx + bracketHalf;
          const lineY1 = my + bracketHalf + coordFont * 1.2;
          const lineY2 = lineY1 + coordFont * 1.4;
          const xText = `X ${nx}`;
          const yText = `Y ${ny}`;
          renderText(xText, rightEdge - measureTextWidth(xText, coordFont), lineY1, coordFont, coordColor);
          renderText(yText, rightEdge - measureTextWidth(yText, coordFont), lineY2, coordFont, coordColor);
        }
      }
    }

    gl.disable(gl.BLEND);

    requestAnimationFrame(render);
  };

  render();
};
