import GUI from '../libs/lil-gui.esm.min.js';

// ---------------------------------------------------------------------------
// Quad Tree node
// ---------------------------------------------------------------------------
class QNode {
  constructor(x, y, w, h, depth) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.depth = depth;
    this.alpha    = 0;
    this.birthAge = 0;   // frames since creation (for birth flash)
    this.children = null;
    this.r = 128; this.g = 128; this.b = 128;
  }
  get isLeaf() { return this.children === null; }
  get cx()     { return this.x + this.w * 0.5; }
  get cy()     { return this.y + this.h * 0.5; }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // --- Config ---
  const config = {
    maxDepth:        7,
    baseRadius:      180,
    velocityFactor:  2.0,
    fadeSpeed:       0.970,
    bgOpacity:       0.0,
    outlineOpacity:  0.30,
    edgeStrength:    1.2,   // extra depth levels added near image edges
    depthSaturation: 1.5,   // saturation boost for deep (fine) cells
    flashFrames:     10,    // how many frames the birth flash lasts
    minCellPx:       4,
  };

  // --- Loading overlay ---
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'display:none',
    'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0.6)', 'color:#fff',
    'font-family:monospace', 'font-size:13px', 'letter-spacing:0.12em',
    'z-index:100', 'pointer-events:none',
  ].join(';');
  overlay.textContent = 'LOADING...';
  document.body.appendChild(overlay);
  const showLoading = v => { overlay.style.display = v ? 'flex' : 'none'; };

  // --- Background canvas (full resolution) ---
  const bgCanvas = document.createElement('canvas');
  const bgCtx    = bgCanvas.getContext('2d');
  let bgData         = null;
  let currentBgImage = null;

  // --- Edge map (Sobel at reduced resolution) ---
  const EDGE_RES  = 512;
  const edgeCanvas = document.createElement('canvas');
  edgeCanvas.width = edgeCanvas.height = EDGE_RES;
  const edgeCtx   = edgeCanvas.getContext('2d');
  let edgeMap = null; // { data: Float32Array, width, height }

  const buildDefaultGradient = () => {
    const w = bgCanvas.width, h = bgCanvas.height;
    const g = bgCtx.createRadialGradient(w * 0.25, h * 0.25, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.7);
    g.addColorStop(0.00, '#ff6b6b');
    g.addColorStop(0.20, '#feca57');
    g.addColorStop(0.45, '#48dbfb');
    g.addColorStop(0.70, '#ff9ff3');
    g.addColorStop(1.00, '#54a0ff');
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, w, h);
  };

  // Sobel edge detection at EDGE_RES x EDGE_RES
  const computeEdgeMap = () => {
    edgeCtx.drawImage(bgCanvas, 0, 0, EDGE_RES, EDGE_RES);
    const img = edgeCtx.getImageData(0, 0, EDGE_RES, EDGE_RES);
    const w = EDGE_RES, h = EDGE_RES, d = img.data;

    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = (d[i*4] * 0.299 + d[i*4+1] * 0.587 + d[i*4+2] * 0.114) / 255;
    }

    const edges = new Float32Array(w * h);
    let maxVal = 0;
    const G = (gray, x, y) => gray[y * w + x];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gx = -G(gray,x-1,y-1) + G(gray,x+1,y-1)
                   -2*G(gray,x-1,y)  + 2*G(gray,x+1,y)
                   -G(gray,x-1,y+1)  + G(gray,x+1,y+1);
        const gy = -G(gray,x-1,y-1) - 2*G(gray,x,y-1) - G(gray,x+1,y-1)
                   +G(gray,x-1,y+1)  + 2*G(gray,x,y+1) + G(gray,x+1,y+1);
        const mag = Math.sqrt(gx*gx + gy*gy);
        edges[y * w + x] = mag;
        if (mag > maxVal) maxVal = mag;
      }
    }
    if (maxVal > 0) for (let i = 0; i < edges.length; i++) edges[i] /= maxVal;

    edgeMap = { data: edges, width: w, height: h };
  };

  const sampleEdge = (x, y) => {
    if (!edgeMap) return 0;
    const ex = Math.max(0, Math.min(edgeMap.width  - 1, Math.floor(x * edgeMap.width  / canvas.width)));
    const ey = Math.max(0, Math.min(edgeMap.height - 1, Math.floor(y * edgeMap.height / canvas.height)));
    return edgeMap.data[ey * edgeMap.width + ex];
  };

  const setBackground = (img = null) => {
    currentBgImage  = img;
    bgCanvas.width  = canvas.width;
    bgCanvas.height = canvas.height;
    if (img) {
      bgCtx.drawImage(img, 0, 0, bgCanvas.width, bgCanvas.height);
    } else {
      buildDefaultGradient();
    }
    bgData = bgCtx.getImageData(0, 0, bgCanvas.width, bgCanvas.height);
    computeEdgeMap();
  };

  const sampleBg = (x, y) => {
    if (!bgData) return [128, 128, 128];
    const bx = Math.max(0, Math.min(bgData.width  - 1, Math.floor(x * bgData.width  / canvas.width)));
    const by = Math.max(0, Math.min(bgData.height - 1, Math.floor(y * bgData.height / canvas.height)));
    const i  = (by * bgData.width + bx) * 4;
    return [bgData.data[i], bgData.data[i+1], bgData.data[i+2]];
  };

  // --- Picsum image loading ---
  let isLoading = false;

  const getImageUrl = () => {
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const w    = Math.min(Math.round(canvas.width  * dpr), 2560);
    const h    = Math.min(Math.round(canvas.height * dpr), 1440);
    const seed = Math.floor(Math.random() * 100000);
    return `https://picsum.photos/${w}/${h}?random=${seed}`;
  };

  const loadImage = url => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });

  let root;
  const makeRoot = () => new QNode(0, 0, canvas.width, canvas.height, 0);

  const loadNextImage = async () => {
    if (isLoading) return;
    isLoading = true;
    showLoading(true);
    try {
      const img = await loadImage(getImageUrl());
      setBackground(img);
    } catch {
      setBackground(null); // fallback to gradient
    }
    root = makeRoot();
    isLoading = false;
    showLoading(false);
  };

  // --- Canvas resize ---
  const resize = () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    setBackground(currentBgImage);
    root = makeRoot();
  };
  resize();
  window.addEventListener('resize', resize);

  // Drag & drop bonus: override with a local file
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file?.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    loadImage(url).then(img => {
      setBackground(img);
      URL.revokeObjectURL(url);
      root = makeRoot();
    });
  });

  // Fetch first image
  loadNextImage();

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  // Depth-based saturation boost: deeper (finer) cells become more vivid
  const applyDepthShift = (r, g, b, depth) => {
    const t   = depth / Math.max(1, config.maxDepth);
    const sat = 1 + t * config.depthSaturation;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return [
      Math.max(0, Math.min(255, lum + (r - lum) * sat)),
      Math.max(0, Math.min(255, lum + (g - lum) * sat)),
      Math.max(0, Math.min(255, lum + (b - lum) * sat)),
    ];
  };

  // ---------------------------------------------------------------------------
  // Quad tree operations
  // ---------------------------------------------------------------------------

  const subdivide = (node) => {
    if (node.children) return;
    const hw = node.w * 0.5, hh = node.h * 0.5;
    if (hw < config.minCellPx || hh < config.minCellPx) return;
    node.children = [
      new QNode(node.x,      node.y,      hw, hh, node.depth + 1),
      new QNode(node.x + hw, node.y,      hw, hh, node.depth + 1),
      new QNode(node.x,      node.y + hh, hw, hh, node.depth + 1),
      new QNode(node.x + hw, node.y + hh, hw, hh, node.depth + 1),
    ];
    for (const c of node.children) {
      c.alpha    = node.alpha;
      c.birthAge = 0;                          // reset: just born
      const [r, g, b] = sampleBg(c.cx, c.cy);
      c.r = r; c.g = g; c.b = b;
    }
  };

  // Push pointer influence + Sobel edge boost into tree
  const updateNode = (node, px, py, speed) => {
    const dx     = node.cx - px, dy = node.cy - py;
    const distSq = dx * dx + dy * dy;
    const inf    = config.baseRadius * (1 + Math.min(speed * config.velocityFactor * 0.01, 2));
    const infSq  = inf * inf;

    if (distSq < infSq) {
      const t = 1 - Math.sqrt(distSq) / inf;
      node.alpha = Math.min(1, node.alpha + t * 0.2);

      // Pointer-driven depth + Sobel edge boost (up to 2 extra levels near edges)
      const edge      = sampleEdge(node.cx, node.cy);
      const edgeExtra = Math.round(edge * config.edgeStrength * 2);
      const desired   = Math.min(config.maxDepth, Math.round(t * t * config.maxDepth) + edgeExtra);

      if (node.isLeaf && node.depth < desired) subdivide(node);
    }

    if (!node.isLeaf) {
      for (const c of node.children) updateNode(c, px, py, speed);
    }
  };

  // Exponential alpha decay + age birth counter
  const fadeNode = (node) => {
    node.alpha *= config.fadeSpeed;
    if (node.birthAge < 255) node.birthAge++;
    if (!node.isLeaf) for (const c of node.children) fadeNode(c);
  };

  // Merge fully faded leaf groups
  const cleanupNode = (node) => {
    if (!node.children) return;
    for (const c of node.children) cleanupNode(c);
    if (node.children.every(c => c.isLeaf && c.alpha < 0.004)) node.children = null;
  };

  // Draw visible leaf cells with depth shift + birth flash
  const renderNode = (node) => {
    if (node.isLeaf) {
      if (node.alpha < 0.004) return;
      const a = node.alpha;

      // 1. Depth-based saturation
      const [dr, dg, db] = applyDepthShift(node.r, node.g, node.b, node.depth);

      // 2. Birth flash: blend toward white over flashFrames frames
      const flash = config.flashFrames > 0
        ? Math.max(0, 1 - node.birthAge / config.flashFrames)
        : 0;
      const fr = Math.round(Math.min(255, dr + (255 - dr) * flash));
      const fg = Math.round(Math.min(255, dg + (255 - dg) * flash));
      const fb = Math.round(Math.min(255, db + (255 - db) * flash));

      ctx.fillStyle = `rgba(${fr},${fg},${fb},${a.toFixed(3)})`;
      ctx.fillRect(node.x, node.y, node.w, node.h);

      const oa = a * config.outlineOpacity;
      if (oa > 0.01 && node.w > 3) {
        ctx.strokeStyle = `rgba(255,255,255,${oa.toFixed(3)})`;
        ctx.lineWidth   = 0.5;
        ctx.strokeRect(node.x + 0.5, node.y + 0.5, node.w - 1, node.h - 1);
      }
      return;
    }
    for (const c of node.children) renderNode(c);
  };

  // ---------------------------------------------------------------------------
  // Pointer tracking
  // ---------------------------------------------------------------------------
  let px = canvas.width * 0.5, py = canvas.height * 0.5;
  let velX = 0, velY = 0;
  let prevX = px, prevY = py;
  let hasPointer = false;

  const track = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    velX += (x - prevX - velX) * 0.4;
    velY += (y - prevY - velY) * 0.4;
    prevX = x; prevY = y;
    px = x; py = y;
    hasPointer = true;
  };

  canvas.addEventListener('mousemove', e => track(e.clientX, e.clientY));
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    track(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('mouseleave', () => { hasPointer = false; });
  canvas.addEventListener('touchend',   () => { hasPointer = false; });

  // Lissajous idle demo when no pointer
  let demoT = 0;
  const demoPos = () => ({
    x: canvas.width  * 0.5 + Math.cos(demoT)       * canvas.width  * 0.28,
    y: canvas.height * 0.5 + Math.sin(demoT * 1.31) * canvas.height * 0.22,
  });

  // ---------------------------------------------------------------------------
  // GUI
  // ---------------------------------------------------------------------------
  const gui = new GUI({ title: 'Quad Tree Trail' });
  gui.add({ next: () => loadNextImage() }, 'next').name('Next Image');
  gui.add(config, 'maxDepth',        2,   9).step(1)     .name('Max Depth');
  gui.add(config, 'baseRadius',     50, 400).step(5)     .name('Influence Radius');
  gui.add(config, 'velocityFactor',  0,   5).step(0.1)   .name('Velocity Factor');
  gui.add(config, 'fadeSpeed',    0.90, 0.999).step(0.001).name('Fade Speed');
  gui.add(config, 'bgOpacity',       0,  0.5).step(0.05) .name('BG Opacity');
  gui.add(config, 'outlineOpacity',  0,   1).step(0.05)  .name('Outline Opacity');
  gui.add(config, 'edgeStrength',    0,   3).step(0.1)   .name('Edge Strength');
  gui.add(config, 'depthSaturation', 0,   3).step(0.1)   .name('Depth Saturation');
  gui.add(config, 'flashFrames',     0,  30).step(1)     .name('Birth Flash');
  gui.add({ reset: () => { root = makeRoot(); } }, 'reset').name('Clear');
  gui.close();

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------
  const loop = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (config.bgOpacity > 0 && bgData) {
      ctx.globalAlpha = config.bgOpacity;
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }

    velX *= 0.85; velY *= 0.85;
    const speed = Math.hypot(velX, velY);

    if (hasPointer) {
      updateNode(root, px, py, speed);
    } else {
      demoT += 0.015;
      const { x, y } = demoPos();
      updateNode(root, x, y, 0);
    }

    fadeNode(root);
    cleanupNode(root);
    renderNode(root);

    requestAnimationFrame(loop);
  };

  loop();
};
