import graphFrag from '../fui/shaders/graph.frag?raw';

/**
 * FPSGraph - WebGL FPS line-graph overlay using fui's graph.frag shader.
 *
 * Accepts the chottoGL instance so it renders into the same WebGL canvas.
 * Call tick() once per animation frame to sample, then render() to draw.
 *
 * Usage (inside a page that already has a cgl / WebGL canvas):
 *   import { FPSGraph } from '../libs/FPSGraph.js';
 *   const fpsGraph = new FPSGraph(cgl, canvas);
 *   // inside render loop:
 *   fpsGraph.tick();
 *   fpsGraph.render({ x, y, width, height });
 */
export class FPSGraph {
  constructor(cgl, canvas, { samples = 120, minFps = 50, maxFps = 70 } = {}) {
    this.cgl = cgl;
    this.canvas = canvas;
    this.samples = samples;
    this.minFps = minFps;
    this.maxFps = maxFps;

    this.buf = new Float32Array(samples);
    this.ptr = 0;
    this.filled = false;
    this.last = performance.now();
    this.current = 0;

    this.shader = cgl.createShader({ fragment: graphFrag });
  }

  tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    const fps = dt > 0 ? 1000 / dt : 0;
    this.current = fps;
    this.buf[this.ptr] = fps;
    this.ptr = (this.ptr + 1) % this.samples;
    if (this.ptr === 0) this.filled = true;
    return fps;
  }

  /** Returns ordered history array (oldest → newest). */
  getHistory() {
    const count = this.filled ? this.samples : this.ptr;
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = this.buf[this.filled ? (this.ptr + i) % this.samples : i];
    }
    return out;
  }

  /**
   * Render the graph into the WebGL canvas.
   * @param {object} opts
   * @param {number} opts.x           Left edge in physical pixels
   * @param {number} opts.y           Bottom edge in physical pixels (WebGL origin)
   * @param {number} opts.width       Width in physical pixels
   * @param {number} opts.height      Height in physical pixels
   * @param {number[]} opts.lineColor RGBA 0-1 line colour (default: dark monochrome)
   * @param {number[]} opts.bgColor   RGBA 0-1 background colour (default: light semi-transparent)
   */
  render({
    x, y, width, height,
    lineColor = [0, 0, 0, 0.7],
    bgColor   = [0.9, 0.9, 0.9, 0.5],
  } = {}) {
    const history = this.getHistory();
    if (history.length < 2) return;

    const { minFps, maxFps, canvas } = this;
    const range = maxFps - minFps;

    // Normalize into 0-1 clamped to the FPS window
    const normalized = new Float32Array(128);
    const count = Math.min(history.length, 128);
    for (let i = 0; i < count; i++) {
      normalized[i] = range > 0
        ? Math.max(0, Math.min(1, (history[i] - minFps) / range))
        : 0.5;
    }

    this.cgl.pass(this.shader, {
      uResolution:  [canvas.width, canvas.height],
      uRect:        [x, y, width, height],
      uValues:      normalized,
      uValueCount:  count,
      uLineColor:   lineColor,
      uBgColor:     bgColor,
      uLineWidth:   2.0,
    });
  }
}
