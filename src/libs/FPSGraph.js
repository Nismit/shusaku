/**
 * FPSGraph - Lightweight overlay for monitoring frame rate.
 *
 * Renders a scrolling bar chart of recent FPS samples on a 2D canvas with
 * a transparent background.  Call tick() once per animation frame.
 *
 * Usage:
 *   import { FPSGraph } from '../libs/FPSGraph.js';
 *   const fps = new FPSGraph();
 *   // inside render loop:
 *   fps.tick();
 */
export class FPSGraph {
  constructor({ samples = 80, width = 100, height = 36 } = {}) {
    this.samples = samples;
    this.width = width;
    this.height = height;
    this.buf = new Float32Array(samples);
    this.ptr = 0;
    this.last = performance.now();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const el = document.createElement('canvas');
    el.width = width * dpr;
    el.height = height * dpr;
    el.style.cssText =
      `position:fixed;top:8px;left:8px;width:${width}px;height:${height}px;` +
      `z-index:20;pointer-events:none`;
    document.body.appendChild(el);

    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);
    this.ctx = ctx;
    this.el = el;
  }

  tick() {
    const now = performance.now();
    const dt = now - this.last;
    const fps = dt > 0 ? 1000 / dt : 0;
    this.last = now;
    this.buf[this.ptr] = fps;
    this.ptr = (this.ptr + 1) % this.samples;
    this._draw(fps);
  }

  _draw(current) {
    const { ctx, width, height, buf, samples, ptr } = this;
    ctx.clearRect(0, 0, width, height);

    const barW = width / samples;
    const plotH = height - 14;

    for (let i = 0; i < samples; i++) {
      const v = buf[(ptr + i) % samples];
      const ratio = Math.min(v / 60, 1);
      const bh = ratio * plotH;
      ctx.fillStyle = v >= 55 ? '#4ade80' : v >= 30 ? '#facc15' : '#f87171';
      ctx.fillRect(i * barW, height - bh, barW - 0.5, bh);
    }

    ctx.fillStyle = 'rgba(245,245,248,0.9)';
    ctx.font = '10px monospace';
    ctx.fillText(`${Math.round(current)} fps`, 2, 10);
  }

  destroy() {
    this.el.remove();
  }
}
