import GUI from '../libs/lil-gui.esm.min.js';

// ---------------------------------------------------------------------------
// Quad Tree node
// ---------------------------------------------------------------------------
class QNode {
  constructor(x, y, w, h, depth) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.depth = depth;
    this.alpha = 0;
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
    maxDepth: 7,
    baseRadius: 180,
    velocityFactor: 2.0,
    fadeSpeed: 0.970,
    bgOpacity: 0.0,
    outlineOpacity: 0.30,
    minCellPx: 4,
  };

  // --- Background image ---
  const bgCanvas = document.createElement('canvas');
  const bgCtx    = bgCanvas.getContext('2d');
  let bgData         = null;
  let currentBgImage = null;

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

  const setBackground = (img = null) => {
    currentBgImage   = img;
    bgCanvas.width   = canvas.width;
    bgCanvas.height  = canvas.height;
    if (img) {
      bgCtx.drawImage(img, 0, 0, bgCanvas.width, bgCanvas.height);
    } else {
      buildDefaultGradient();
    }
    bgData = bgCtx.getImageData(0, 0, bgCanvas.width, bgCanvas.height);
  };

  // Sample pixel color from background at canvas-space (x, y)
  const sampleBg = (x, y) => {
    if (!bgData) return [128, 128, 128];
    const bx = Math.max(0, Math.min(bgData.width  - 1, Math.floor(x * bgData.width  / canvas.width)));
    const by = Math.max(0, Math.min(bgData.height - 1, Math.floor(y * bgData.height / canvas.height)));
    const i  = (by * bgData.width + bx) * 4;
    return [bgData.data[i], bgData.data[i + 1], bgData.data[i + 2]];
  };

  // --- Canvas resize ---
  let root;
  const makeRoot = () => new QNode(0, 0, canvas.width, canvas.height, 0);

  const resize = () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    setBackground(currentBgImage);
    root = makeRoot();
  };
  resize();
  window.addEventListener('resize', resize);

  // --- Drag & drop background image ---
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file?.type.startsWith('image/')) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { setBackground(img); URL.revokeObjectURL(url); root = makeRoot(); };
    img.src = url;
  });

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
      c.alpha = node.alpha;
      const [r, g, b] = sampleBg(c.cx, c.cy);
      c.r = r; c.g = g; c.b = b;
    }
  };

  // Push pointer influence into tree, subdividing as needed
  const updateNode = (node, px, py, speed) => {
    const dx = node.cx - px, dy = node.cy - py;
    const distSq = dx * dx + dy * dy;
    const inf    = config.baseRadius * (1 + Math.min(speed * config.velocityFactor * 0.01, 2));
    const infSq  = inf * inf;

    if (distSq < infSq) {
      const t = 1 - Math.sqrt(distSq) / inf;
      // Ramp alpha up smoothly; cell saturates at 1.0
      node.alpha = Math.min(1, node.alpha + t * 0.2);

      // Desired subdivision depth falls off quadratically with distance
      const desired = Math.round(t * t * config.maxDepth);
      if (node.isLeaf && node.depth < desired) subdivide(node);
    }

    if (!node.isLeaf) {
      for (const c of node.children) updateNode(c, px, py, speed);
    }
  };

  // Exponential alpha decay per frame
  const fadeNode = (node) => {
    node.alpha *= config.fadeSpeed;
    if (!node.isLeaf) for (const c of node.children) fadeNode(c);
  };

  // Merge children that have all faded to invisible
  const cleanupNode = (node) => {
    if (!node.children) return;
    for (const c of node.children) cleanupNode(c);
    if (node.children.every(c => c.isLeaf && c.alpha < 0.004)) node.children = null;
  };

  // Draw visible leaf cells
  const renderNode = (node) => {
    if (node.isLeaf) {
      if (node.alpha < 0.004) return;
      const a = node.alpha;
      ctx.fillStyle = `rgba(${node.r},${node.g},${node.b},${a.toFixed(3)})`;
      ctx.fillRect(node.x, node.y, node.w, node.h);

      const oa = a * config.outlineOpacity;
      if (oa > 0.01 && node.w > 3) {
        ctx.strokeStyle = `rgba(255,255,255,${oa.toFixed(3)})`;
        ctx.lineWidth = 0.5;
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
    const x = clientX - rect.left;
    const y = clientY - rect.top;
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
  canvas.addEventListener('mouseleave',  () => { hasPointer = false; });
  canvas.addEventListener('touchend',    () => { hasPointer = false; });

  // Lissajous orbit shown when no pointer (demo / idle state)
  let demoT = 0;
  const demoPos = () => ({
    x: canvas.width  * 0.5 + Math.cos(demoT)       * canvas.width  * 0.28,
    y: canvas.height * 0.5 + Math.sin(demoT * 1.31) * canvas.height * 0.22,
  });

  // ---------------------------------------------------------------------------
  // GUI
  // ---------------------------------------------------------------------------
  const gui = new GUI({ title: 'Quad Tree Trail' });
  gui.add(config, 'maxDepth',       2,   9).step(1)    .name('Max Depth');
  gui.add(config, 'baseRadius',    50, 400).step(5)    .name('Influence Radius');
  gui.add(config, 'velocityFactor', 0,   5).step(0.1)  .name('Velocity Factor');
  gui.add(config, 'fadeSpeed',   0.90, 0.999).step(0.001).name('Fade Speed');
  gui.add(config, 'bgOpacity',      0, 0.5).step(0.05) .name('BG Opacity');
  gui.add(config, 'outlineOpacity', 0,   1).step(0.05) .name('Outline Opacity');
  gui.add({ reset: () => { root = makeRoot(); } }, 'reset').name('Clear');
  gui.close();

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------
  const loop = () => {
    // Black base
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Optional: faint background image always visible
    if (config.bgOpacity > 0 && bgData) {
      ctx.globalAlpha = config.bgOpacity;
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }

    // Velocity decay
    velX *= 0.85;
    velY *= 0.85;
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
