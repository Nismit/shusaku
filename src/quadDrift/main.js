import { chottoGL } from '../libs/esChottoGL.js';
import GUI from '../libs/gui.js';

import glyphVert from './shaders/glyph.vert?raw';
import glyphFrag from './shaders/glyph.frag?raw';
import lineVert from './shaders/line.vert?raw';
import lineFrag from './shaders/line.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';

const FONT_FILE = 'inter-atlas';

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// --- Deterministic hash / value noise ---------------------------------------

const hash3i = (i, j, k) => {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Quintic fade — C2 continuous, which matters because the curl below takes a
// numerical derivative of this field.
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

const valueNoise3 = (x, y, z) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);

  const c = (dx, dy, dz) => hash3i(xi + dx, yi + dy, zi + dz);

  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * xf;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * xf;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * xf;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * xf;

  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;

  return (y0 + (y1 - y0) * zf) * 2 - 1;
};

const fbm3 = (x, y, z) => {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    sum += valueNoise3(x * freq, y * freq, z * freq + i * 19.7) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
};

export const main = async () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const cgl = chottoGL(canvas);
  const gl = cgl.gl;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const applyDPR = () => {
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  applyDPR();
  window.addEventListener('resize', applyDPR);

  const config = {
    maxDepth: 6,         // depth 1 stays blank, so this is digit 5 at the core
    rootCols: 3,
    ringWidth: 80,       // CSS px of radius per depth level
    emptyChance: 0.28,   // share of cells that stay blank at any depth
    digitSize: 0.52,     // digit height as a fraction of its cell
    lineWidth: 1.0,      // CSS px
    lineAlpha: 0.3,
    textAlpha: 0.95,
    speed: 0.035,        // sweep cycles per second
    wander: 0.13,        // curl displacement, fraction of the viewport
    noiseScale: 0.55,    // curl field frequency, per viewport height
    timeScale: 0.12,     // how fast the field itself evolves
    grain: 0.03,
    grainScale: 1.5,     // grain cell size in CSS px
    textColor: '#ddd7c6',
    bgColor: '#0a0908',
  };

  const glyphShader = cgl.createShader({ vertex: glyphVert, fragment: glyphFrag });
  const lineShader = cgl.createShader({ vertex: lineVert, fragment: lineFrag });
  const compositeShader = cgl.createShader({ fragment: compositeFrag });

  // Ink coverage is accumulated with MAX blending, so overlapping cell borders
  // and digits resolve to a single flat value before being coloured.
  const coverageFBO = cgl.createFramebuffer(canvas.width, canvas.height);
  window.addEventListener('resize', () => coverageFBO.resize(canvas.width, canvas.height));

  // --- Font atlas -----------------------------------------------------------

  const font = {
    atlas: null,
    atlasSize: [0, 0],
    distanceRange: 2,
    digits: [],     // planeBounds / atlasBounds for '1'..'9', index 0 = '1'
    top: 0,
    bottom: 0,
  };

  {
    const [imgResponse, jsonResponse] = await Promise.all([
      fetch(`/fonts/${FONT_FILE}.png`),
      fetch(`/fonts/${FONT_FILE}.json`),
    ]);

    const bitmap = await createImageBitmap(await imgResponse.blob());
    const data = await jsonResponse.json();

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    font.atlas = texture;
    font.atlasSize = [data.atlas.width, data.atlas.height];
    font.distanceRange = data.atlas.distanceRange;

    const byChar = new Map();
    for (const g of data.glyphs) byChar.set(String.fromCharCode(g.unicode), g);

    for (let d = 1; d <= 9; d++) font.digits.push(byChar.get(String(d)));
    // One shared vertical metric for every digit, so a '1' and a '6' in
    // neighbouring cells sit on the same optical line.
    font.top = Math.max(...font.digits.map((g) => g.planeBounds.top));
    font.bottom = Math.min(...font.digits.map((g) => g.planeBounds.bottom));
  }

  const emHeight = font.top - font.bottom;

  // --- Dynamic geometry buffers ---------------------------------------------

  const makeStream = (floatsPerVertex, attribs) => {
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = floatsPerVertex * 4;
    for (const a of attribs) {
      gl.enableVertexAttribArray(a.index);
      gl.vertexAttribPointer(a.index, a.size, gl.FLOAT, false, stride, a.offset * 4);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return {
      buffer,
      vao,
      floatsPerVertex,
      data: new Float32Array(floatsPerVertex * 6 * 1024),
      length: 0,
      capacity: 0,
      reset() { this.length = 0; },
      // 6 vertices per quad; grow geometrically so a sudden burst of cells
      // costs one reallocation rather than one per quad.
      reserve(floats) {
        if (this.length + floats <= this.data.length) return;
        let size = this.data.length;
        while (size < this.length + floats) size *= 2;
        const next = new Float32Array(size);
        next.set(this.data.subarray(0, this.length));
        this.data = next;
      },
      upload() {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        if (this.data.length > this.capacity) {
          gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
          this.capacity = this.data.length;
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.length);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      },
      get vertexCount() { return this.length / this.floatsPerVertex; },
    };
  };

  const lineStream = makeStream(2, [{ index: 0, size: 2, offset: 0 }]);
  const glyphStream = makeStream(4, [
    { index: 0, size: 2, offset: 0 },
    { index: 1, size: 2, offset: 2 },
  ]);

  // Pixel space (y-down, physical pixels) → clip space.
  let toClipX = 0;
  let toClipY = 0;

  const pushLineRect = (x0, y0, x1, y1) => {
    lineStream.reserve(12);
    const d = lineStream.data;
    let i = lineStream.length;
    const ax = x0 * toClipX - 1, ay = 1 - y0 * toClipY;
    const bx = x1 * toClipX - 1, by = 1 - y1 * toClipY;
    d[i++] = ax; d[i++] = ay;
    d[i++] = bx; d[i++] = ay;
    d[i++] = ax; d[i++] = by;
    d[i++] = bx; d[i++] = ay;
    d[i++] = bx; d[i++] = by;
    d[i++] = ax; d[i++] = by;
    lineStream.length = i;
  };

  // Emits one glyph quad, rotated by `turn` quarter-turns about the cell centre.
  const pushGlyph = (glyph, cx, cy, fontSize, turn) => {
    const pb = glyph.planeBounds;
    const ab = glyph.atlasBounds;

    // Ink box relative to the cell centre: horizontally centred on the glyph's
    // own ink, vertically on the digit metrics shared by 1–9.
    const hw = (pb.right - pb.left) * fontSize * 0.5;
    const hh = (font.top - font.bottom) * fontSize * 0.5;
    // Where this glyph's ink sits inside the shared digit box.
    const yShift = ((font.top + font.bottom) * 0.5 - (pb.top + pb.bottom) * 0.5) * fontSize;
    const top = -hh - yShift;
    const bottom = hh - yShift;

    const s = turn === 0 ? 0 : turn === 1 ? 1 : turn === 2 ? 0 : -1;
    const c = turn === 0 ? 1 : turn === 1 ? 0 : turn === 2 ? -1 : 0;

    const px = (x, y) => (cx + x * c - y * s) * toClipX - 1;
    const py = (x, y) => 1 - (cy + x * s + y * c) * toClipY;

    const u0 = ab.left / font.atlasSize[0];
    const u1 = ab.right / font.atlasSize[0];
    const v0 = 1 - ab.top / font.atlasSize[1];    // pairs with the top corners
    const v1 = 1 - ab.bottom / font.atlasSize[1]; // pairs with the bottom corners

    glyphStream.reserve(24);
    const d = glyphStream.data;
    let i = glyphStream.length;
    const put = (x, y, u, v) => {
      d[i++] = px(x, y); d[i++] = py(x, y); d[i++] = u; d[i++] = v;
    };
    put(-hw, top, u0, v0);
    put(hw, top, u1, v0);
    put(-hw, bottom, u0, v1);
    put(hw, top, u1, v0);
    put(hw, bottom, u1, v1);
    put(-hw, bottom, u0, v1);
    glyphStream.length = i;
  };

  // --- Attractor --------------------------------------------------------------

  const attractor = { x: 0.5, y: 0.5 }; // normalised viewport coords
  let phase = 0;

  // Curl of a scalar fBm potential — divergence-free, so the offset it produces
  // swirls rather than collapsing into a sink.
  const curl = (x, y, t) => {
    const e = 0.004;
    const s = config.noiseScale;
    const psi = (px, py) => fbm3(px * s, py * s, t);
    const dpdy = (psi(x, y + e) - psi(x, y - e)) / (2 * e);
    const dpdx = (psi(x + e, y) - psi(x - e, y)) / (2 * e);
    return [dpdy, -dpdx];
  };

  // Integrating the curl field as a velocity lets the point loiter and double
  // back, and every reversal flickers a whole ring of cells in and out. The
  // path is therefore driven by three epicycles instead. Their frequency ratios
  // are irrational, so the curve never repeats and fills the frame; and because
  // r0*f0 exceeds r1*f1 + r2*f2, the tangential speed has a positive lower
  // bound — the point can never stall or reverse, whatever the phases do.
  const EPI = [
    { r: 0.26, f: 1.0, p: 0.0 },
    { r: 0.15, f: 0.6180339887, p: 1.7 },
    { r: 0.09, f: 0.2545, p: 4.1 },
  ];

  const stepAttractor = (dt, aspect) => {
    phase += dt * config.speed;

    const TAU = Math.PI * 2;
    let bx = 0.5;
    let by = 0.5;
    for (const e of EPI) {
      const a = TAU * phase * e.f + e.p;
      bx += e.r * Math.cos(a);
      by += e.r * Math.sin(a);
    }

    // Raw curl, not a normalised direction: normalising makes the offset snap
    // to the opposite side whenever the field vector passes through zero.
    const [ox, oy] = curl(bx * aspect, by, phase * config.timeScale * 8);

    attractor.x = bx + ox * config.wander;
    attractor.y = by + oy * config.wander;
  };

  // --- Quadtree ---------------------------------------------------------------

  const lineHalf = () => Math.max(config.lineWidth * dpr, 1) * 0.5;

  // `ix`/`iy` are the cell's integer coordinates at its own depth, seeded by the
  // root cell — a stable identity, so a cell's digit orientation never flickers
  // as long as the cell exists.
  const subdivide = (x, y, w, h, depth, ix, iy, ax, ay, ring) => {
    if (depth < config.maxDepth) {
      // Distance from the attractor to the nearest point of this cell.
      const dx = Math.max(x - ax, 0, ax - (x + w));
      const dy = Math.max(y - ay, 0, ay - (y + h));
      const dist = Math.hypot(dx, dy);

      // Equal-width rings rather than a size-vs-distance ratio: the ratio rule
      // makes every coarse cell close enough to something to keep splitting,
      // so depth 1 — the blank level — never actually survives on screen.
      if (dist < (config.maxDepth - depth) * ring) {
        const hw = w * 0.5;
        const hh = h * 0.5;
        subdivide(x, y, hw, hh, depth + 1, ix * 2, iy * 2, ax, ay, ring);
        subdivide(x + hw, y, hw, hh, depth + 1, ix * 2 + 1, iy * 2, ax, ay, ring);
        subdivide(x, y + hh, hw, hh, depth + 1, ix * 2, iy * 2 + 1, ax, ay, ring);
        subdivide(x + hw, y + hh, hw, hh, depth + 1, ix * 2 + 1, iy * 2 + 1, ax, ay, ring);
        return;
      }
    }

    const t = lineHalf();
    // Each leaf draws only its left and top edges; the shared edge with a
    // neighbour is therefore drawn exactly once. The outer frame is added
    // separately by the caller.
    pushLineRect(x - t, y - t, x + t, y + h + t);
    pushLineRect(x - t, y - t, x + w + t, y + t);

    // Depth 1 is left empty on purpose: the bare cells give the composition
    // somewhere to breathe, so the numbering starts at 1 one level down.
    const digit = font.digits[depth - 2];
    if (!digit) return;

    // A share of cells at every depth is left blank too, punching holes through
    // the dense middle of the cascade. Keyed off the cell id like the rotation
    // is, so a given cell is either always blank or never blank.
    if (hash3i(ix * 7 + 13, iy * 11 + 29, depth + 977) < config.emptyChance) return;

    const fontSize = (Math.min(w, h) * config.digitSize) / emHeight;
    const turn = Math.floor(hash3i(ix + depth * 8191, iy + depth * 131, depth) * 4) & 3;
    pushGlyph(digit, x + w * 0.5, y + h * 0.5, fontSize, turn);
  };

  // --- GUI --------------------------------------------------------------------

  const gui = new GUI({ title: 'Quad Drift' });

  const treeFolder = gui.addFolder('Quadtree');
  treeFolder.add(config, 'maxDepth', 3, 9).step(1).name('Max Depth');
  treeFolder.add(config, 'rootCols', 1, 6).step(1).name('Root Columns');
  treeFolder.add(config, 'ringWidth', 30, 300).step(5).name('Ring Width (px)');
  treeFolder.add(config, 'emptyChance', 0, 0.7).step(0.01).name('Empty Cells');
  treeFolder.open();

  const driftFolder = gui.addFolder('Drift');
  driftFolder.add(config, 'speed', 0, 0.15).step(0.005).name('Sweep Speed');
  driftFolder.add(config, 'wander', 0, 0.35).step(0.01).name('Wander');
  driftFolder.add(config, 'noiseScale', 0.1, 2).step(0.05).name('Field Scale');
  driftFolder.add(config, 'timeScale', 0, 1).step(0.01).name('Field Evolve');
  driftFolder.open();

  const lookFolder = gui.addFolder('Look');
  lookFolder.add(config, 'digitSize', 0.15, 0.9).step(0.01).name('Digit Size');
  lookFolder.add(config, 'lineWidth', 0.25, 4).step(0.25).name('Line Width (px)');
  lookFolder.add(config, 'lineAlpha', 0, 1).step(0.01).name('Line Opacity');
  lookFolder.add(config, 'textAlpha', 0, 1).step(0.01).name('Digit Opacity');
  lookFolder.add(config, 'grain', 0, 0.15).step(0.005).name('Grain');
  lookFolder.add(config, 'grainScale', 0.5, 6).step(0.5).name('Grain Size (px)');
  lookFolder.addColor(config, 'textColor').name('Ink');
  lookFolder.addColor(config, 'bgColor').name('Background');
  lookFolder.open();

  gui.close();

  // --- Render -----------------------------------------------------------------

  let lastTime = performance.now();

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 20);
    lastTime = now;

    const W = canvas.width;
    const H = canvas.height;
    toClipX = 2 / W;
    toClipY = 2 / H;

    stepAttractor(dt, W / H);

    const ax = attractor.x * W;
    const ay = attractor.y * H;

    // Root grid tiles the canvas exactly. Rows are chosen to make the cells as
    // close to square as the viewport allows — a few percent off square is
    // invisible, whereas an overhanging square grid clips digits at the edges.
    const cols = config.rootCols;
    const rows = Math.max(1, Math.round((H * cols) / W));
    const cellW = W / cols;
    const cellH = H / rows;

    lineStream.reset();
    glyphStream.reset();

    const ring = config.ringWidth * dpr;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        subdivide(c * cellW, r * cellH, cellW, cellH, 1, c * 4096, r * 4096, ax, ay, ring);
      }
    }

    // Outer frame. The right and bottom edges belong to no leaf, and the left
    // and top ones would otherwise sit half off-screen and read as thinner.
    const t = lineHalf();
    pushLineRect(0, 0, t * 2, H);
    pushLineRect(0, 0, W, t * 2);
    pushLineRect(W - t * 2, 0, W, H);
    pushLineRect(0, H - t * 2, W, H);

    lineStream.upload();
    glyphStream.upload();

    coverageFBO.clear(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);

    lineShader
      .use()
      .set({ uAlpha: config.lineAlpha })
      .draw(lineStream.vao, gl.TRIANGLES, lineStream.vertexCount);

    glyphShader
      .use()
      .set({
        uAtlas: font.atlas,
        uAtlasSize: font.atlasSize,
        uDistanceRange: font.distanceRange,
        uAlpha: config.textAlpha,
      })
      .draw(glyphStream.vao, gl.TRIANGLES, glyphStream.vertexCount);

    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);

    cgl.pass(compositeShader, {
      uCoverage: coverageFBO,
      uInk: hexToRgb(config.textColor),
      uBg: hexToRgb(config.bgColor),
      uGrain: config.grain,
      uGrainScale: config.grainScale * dpr,
      uTime: now * 0.001,
    });

    requestAnimationFrame(render);
  };

  render();
};
