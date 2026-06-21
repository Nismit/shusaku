/**
 * FPSGraph - 2D canvas overlay FPS monitor with transparent background.
 *
 * Renders a scrolling line-graph consistent with the FUI black-on-white
 * aesthetic.  Background is fully transparent (clearRect); the black line
 * and fill sit directly on whatever is behind the canvas.
 *
 * Call tick() once per animation frame — drawing happens automatically.
 *
 * Usage:
 *   import { FPSGraph } from '../libs/FPSGraph.js';
 *   const fpsGraph = new FPSGraph();
 *   // inside render loop:
 *   fpsGraph.tick();
 */
export class FPSGraph {
  constructor({
    samples = 120,
    minFps  = 50,
    maxFps  = 70,
    width   = 120,
    height  = 30,
    bottom  = 40,
    left    = 40,
  } = {}) {
    this.samples  = samples;
    this.minFps   = minFps;
    this.maxFps   = maxFps;
    this.width    = width;
    this.height   = height;
    this.buf      = new Float32Array(samples);
    this.ptr      = 0;
    this.filled   = false;
    this.last     = performance.now();
    this.current  = 0;
    this.renderMs = 0;

    const msLabelH  = 11;
    this._msLabelH  = msLabelH;
    const totalH    = height + msLabelH;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const el  = document.createElement('canvas');
    el.width  = width   * dpr;
    el.height = totalH  * dpr;
    el.style.cssText =
      `position:fixed;bottom:${bottom}px;left:${left}px;` +
      `width:${width}px;height:${totalH}px;z-index:20;pointer-events:none`;
    document.body.appendChild(el);

    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);
    this.ctx = ctx;
    this.el  = el;
  }

  setRenderMs(ms) {
    this.renderMs = ms;
  }

  tick() {
    const now = performance.now();
    const dt  = now - this.last;
    this.last = now;

    const fps    = dt > 0 ? 1000 / dt : 0;
    this.current  = fps;
    this.renderMs = dt;
    this.buf[this.ptr] = fps;
    this.ptr = (this.ptr + 1) % this.samples;
    if (this.ptr === 0) this.filled = true;

    this._draw();
    return fps;
  }

  _draw() {
    const { ctx, width, height, buf, samples, ptr, filled, minFps, maxFps, _msLabelH } = this;
    const totalH = height + _msLabelH;

    // Transparent background
    ctx.clearRect(0, 0, width, totalH);

    const count = filled ? samples : ptr;
    if (count < 2) return;

    const labelH = 12;
    const plotH  = height - labelH;
    const range  = maxFps - minFps;
    const norm   = v => Math.max(0, Math.min(1, (v - minFps) / range));

    // Build ordered value array (oldest → newest)
    const vals = [];
    for (let i = 0; i < count; i++) {
      vals.push(buf[filled ? (ptr + i) % samples : i]);
    }

    // Fill area below line
    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const x = (i / (vals.length - 1)) * width;
      const y = labelH + plotH * (1 - norm(vals[i]));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(width, labelH + plotH);
    ctx.lineTo(0,     labelH + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const x = (i / (vals.length - 1)) * width;
      const y = labelH + plotH * (1 - norm(vals[i]));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // FPS label
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font      = '10px monospace';
    ctx.fillText(`${Math.round(this.current)} fps`, 0, 10);

    // Render time label below graph
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font      = '9px monospace';
    ctx.fillText(`${this.renderMs.toFixed(2)} ms`, 0, height + _msLabelH - 1);
  }

  destroy() {
    this.el.remove();
  }
}
