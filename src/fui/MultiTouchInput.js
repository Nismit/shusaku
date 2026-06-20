/**
 * MultiTouchInput - Multi-touch input handler with velocity tracking
 */
export class MultiTouchInput {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      maxTouches: 5,
      preventTouchDefault: true,
      ...options
    };

    // Active pointers (mouse + touches)
    this.pointers = new Map();

    // Mouse state
    this.mouseId = -1;
    this.mouseInside = false;
    this.mousePixelX = 0;
    this.mousePixelY = 0;
    this.lastMoveTime = 0;

    this._boundHandlers = {
      mouseMove: this._handleMouseMove.bind(this),
      mouseDown: this._handleMouseDown.bind(this),
      mouseUp: this._handleMouseUp.bind(this),
      mouseEnter: this._handleMouseEnter.bind(this),
      mouseLeave: this._handleMouseLeave.bind(this),
      touchStart: this._handleTouchStart.bind(this),
      touchMove: this._handleTouchMove.bind(this),
      touchEnd: this._handleTouchEnd.bind(this),
    };

    this._addEventListeners();
  }

  _addEventListeners() {
    const { canvas, _boundHandlers: h } = this;
    canvas.addEventListener('mousemove', h.mouseMove);
    canvas.addEventListener('mousedown', h.mouseDown);
    canvas.addEventListener('mouseup', h.mouseUp);
    canvas.addEventListener('mouseenter', h.mouseEnter);
    canvas.addEventListener('mouseleave', h.mouseLeave);
    canvas.addEventListener('touchstart', h.touchStart, { passive: !this.options.preventTouchDefault });
    canvas.addEventListener('touchmove', h.touchMove, { passive: !this.options.preventTouchDefault });
    canvas.addEventListener('touchend', h.touchEnd);
    canvas.addEventListener('touchcancel', h.touchEnd);
  }

  _removeEventListeners() {
    const { canvas, _boundHandlers: h } = this;
    canvas.removeEventListener('mousemove', h.mouseMove);
    canvas.removeEventListener('mousedown', h.mouseDown);
    canvas.removeEventListener('mouseup', h.mouseUp);
    canvas.removeEventListener('mouseenter', h.mouseEnter);
    canvas.removeEventListener('mouseleave', h.mouseLeave);
    canvas.removeEventListener('touchstart', h.touchStart);
    canvas.removeEventListener('touchmove', h.touchMove);
    canvas.removeEventListener('touchend', h.touchEnd);
    canvas.removeEventListener('touchcancel', h.touchEnd);
  }

  _createPointer(id, clientX, clientY, pressure = 0.5) {
    const rect = this.canvas.getBoundingClientRect();
    const pixelX = clientX - rect.left;
    const pixelY = clientY - rect.top;
    const normalizedX = (pixelX / rect.width) * 2 - 1;
    const normalizedY = -((pixelY / rect.height) * 2 - 1);

    return {
      id,
      pixelX,
      pixelY,
      normalizedX,
      normalizedY,
      prevPixelX: pixelX,
      prevPixelY: pixelY,
      velocityX: 0,
      velocityY: 0,
      normalizedVelocityX: 0,
      normalizedVelocityY: 0,
      pressure,
      startTime: performance.now(),
      lastUpdateTime: performance.now(),
    };
  }

  _updatePointer(pointer, clientX, clientY, pressure = pointer.pressure) {
    const rect = this.canvas.getBoundingClientRect();
    const now = performance.now();
    const dt = Math.max(now - pointer.lastUpdateTime, 1);

    pointer.prevPixelX = pointer.pixelX;
    pointer.prevPixelY = pointer.pixelY;
    pointer.pixelX = clientX - rect.left;
    pointer.pixelY = clientY - rect.top;
    pointer.normalizedX = (pointer.pixelX / rect.width) * 2 - 1;
    pointer.normalizedY = -((pointer.pixelY / rect.height) * 2 - 1);

    // Velocity (normalized to 60fps)
    const dtNorm = dt / 16.67;
    pointer.velocityX = (pointer.pixelX - pointer.prevPixelX) / dtNorm;
    pointer.velocityY = (pointer.pixelY - pointer.prevPixelY) / dtNorm;
    pointer.normalizedVelocityX = pointer.velocityX / rect.width * 2;
    pointer.normalizedVelocityY = -pointer.velocityY / rect.height * 2;
    pointer.pressure = pressure;
    pointer.lastUpdateTime = now;
  }

  // Mouse handlers
  _handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mousePixelX = e.clientX - rect.left;
    this.mousePixelY = e.clientY - rect.top;
    this.lastMoveTime = performance.now();

    if (this.pointers.has(this.mouseId)) {
      this._updatePointer(this.pointers.get(this.mouseId), e.clientX, e.clientY);
    }
  }

  _handleMouseDown(e) {
    const pointer = this._createPointer(this.mouseId, e.clientX, e.clientY);
    this.pointers.set(this.mouseId, pointer);
  }

  _handleMouseUp() {
    this.pointers.delete(this.mouseId);
  }

  _handleMouseEnter(e) {
    this.mouseInside = true;
    const rect = this.canvas.getBoundingClientRect();
    this.mousePixelX = e.clientX - rect.left;
    this.mousePixelY = e.clientY - rect.top;
    this.lastMoveTime = performance.now();

    if (e.buttons > 0) {
      const pointer = this._createPointer(this.mouseId, e.clientX, e.clientY);
      this.pointers.set(this.mouseId, pointer);
    }
  }

  _handleMouseLeave() {
    this.mouseInside = false;
    this.pointers.delete(this.mouseId);
  }

  // Touch handlers
  _handleTouchStart(e) {
    if (this.options.preventTouchDefault) e.preventDefault();

    for (const touch of e.changedTouches) {
      if (this.pointers.size >= this.options.maxTouches) break;
      const pointer = this._createPointer(
        touch.identifier,
        touch.clientX,
        touch.clientY,
        touch.force || 0.5
      );
      this.pointers.set(touch.identifier, pointer);
    }
  }

  _handleTouchMove(e) {
    if (this.options.preventTouchDefault) e.preventDefault();

    for (const touch of e.changedTouches) {
      if (this.pointers.has(touch.identifier)) {
        this._updatePointer(
          this.pointers.get(touch.identifier),
          touch.clientX,
          touch.clientY,
          touch.force || 0.5
        );
      }
    }
  }

  _handleTouchEnd(e) {
    for (const touch of e.changedTouches) {
      this.pointers.delete(touch.identifier);
    }
  }

  // Public API

  /** Get number of active pointers */
  getCount() {
    return this.pointers.size;
  }

  /** Get all active pointers as array */
  getPointers() {
    return Array.from(this.pointers.values());
  }

  /** Get pointer by id */
  getPointer(id) {
    return this.pointers.get(id);
  }

  /** Calculate distance between two pointers (normalized) */
  getDistance(p1, p2) {
    const dx = p2.normalizedX - p1.normalizedX;
    const dy = p2.normalizedY - p1.normalizedY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Calculate angle between two pointers (radians) */
  getAngle(p1, p2) {
    return Math.atan2(
      p2.normalizedY - p1.normalizedY,
      p2.normalizedX - p1.normalizedX
    );
  }

  /** Calculate centroid of all pointers (normalized) */
  getCentroid() {
    const pointers = this.getPointers();
    if (pointers.length === 0) return { x: 0, y: 0 };

    let sumX = 0, sumY = 0;
    for (const p of pointers) {
      sumX += p.normalizedX;
      sumY += p.normalizedY;
    }
    return {
      x: sumX / pointers.length,
      y: sumY / pointers.length
    };
  }

  /** Calculate area of triangle formed by 3 pointers (normalized) */
  getTriangleArea(p1, p2, p3) {
    return Math.abs(
      (p1.normalizedX * (p2.normalizedY - p3.normalizedY) +
       p2.normalizedX * (p3.normalizedY - p1.normalizedY) +
       p3.normalizedX * (p1.normalizedY - p2.normalizedY)) / 2
    );
  }

  destroy() {
    this._removeEventListeners();
    this.pointers.clear();
    this.canvas = null;
  }
}
