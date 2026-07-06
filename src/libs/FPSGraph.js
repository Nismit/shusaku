class FPSGraphStub {
  update() {}
  destroy() {}
}

class FPSGraphImpl {
  constructor() {
    this._maxFPS = 60;
    this._samples = 60;
    this._history = [];
    this._prevTime = performance.now();
    this._frames = 0;
    this._fps = 0;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._dpr = dpr;
    this._w = 140;
    this._labelH = 18;
    this._graphH = 40;
    this._h = this._labelH + this._graphH;
    this._pad = 4;

    const c = document.createElement('canvas');
    c.width = this._w * dpr;
    c.height = this._h * dpr;
    Object.assign(c.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: '9999',
      width: this._w + 'px',
      height: this._h + 'px',
      pointerEvents: 'none',
    });
    this._canvas = c;
    this._ctx = c.getContext('2d');
    this._ctx.scale(dpr, dpr);

    document.body.appendChild(c);
  }

  update() {
    this._frames++;
    const now = performance.now();
    const dt = now - this._prevTime;

    if (dt < 200) return;

    this._fps = Math.round(this._frames * 1000 / dt);
    this._history.push(Math.min(this._fps, this._maxFPS));
    if (this._history.length > this._samples) this._history.shift();
    this._frames = 0;
    this._prevTime = now;
    this._draw();
  }

  _draw() {
    const { _ctx: ctx, _w: w, _h: h, _pad: pad, _labelH: labelH, _graphH: graphH, _history: hist, _maxFPS: maxFPS, _samples: samples } = this;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`FPS ${this._fps}`, pad, pad);

    if (hist.length < 2) return;

    const gx = pad;
    const gy = labelH;
    const gw = w - pad * 2;
    const gh = graphH - pad;
    const len = hist.length;
    const step = gw / (samples - 1);
    const off = (samples - len) * step;

    const px = (i) => gx + off + i * step;
    const py = (i) => gy + gh - (hist[Math.max(0, Math.min(i, len - 1))] / maxFPS) * gh;

    ctx.beginPath();
    ctx.moveTo(px(0), py(0));

    for (let i = 0; i < len - 1; i++) {
      const x0 = px(i - 1), y0 = py(i - 1);
      const x1 = px(i), y1 = py(i);
      const x2 = px(i + 1), y2 = py(i + 1);
      const x3 = px(i + 2), y3 = py(i + 2);

      ctx.bezierCurveTo(
        x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6,
        x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6,
        x2, y2,
      );
    }

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  destroy() {
    this._canvas.remove();
  }
}

export const FPSGraph = import.meta.env.DEV ? FPSGraphImpl : FPSGraphStub;
