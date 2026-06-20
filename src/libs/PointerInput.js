/**
 * PointerInput - Class for abstracting mouse and touch input
 * 
 * Usage example:
 * ```javascript
 * const pointer = new PointerInput(canvas);
 * 
 * // Get pointer position (normalized coordinates from -1 to 1)
 * const pos = pointer.getNormalizedPosition();
 * console.log(pos.x, pos.y);
 * 
 * // Get pointer velocity
 * const velocity = pointer.getVelocity();
 * 
 * // Check pressed state
 * if (pointer.isPressed()) {
 *   console.log('Pointer is pressed');
 * }
 * 
 * // Set callback
 * pointer.onMove((pos) => {
 *   console.log('Pointer moved:', pos);
 * });
 * 
 * // Destroy
 * pointer.destroy();
 * ```
 */
export class PointerInput {
  /**
   * @param {HTMLCanvasElement} canvas - Target canvas element
   * @param {Object} options - Option settings
   * @param {boolean} options.trackVelocity - Whether to track velocity (default: true)
   * @param {boolean} options.preventTouchDefault - Whether to prevent touch default behavior (default: true)
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      trackVelocity: true,
      preventTouchDefault: true,
      ...options
    };
    
    // Mouse/Touch state
    this.state = {
      // Pixel coordinates
      pixelX: 0,
      pixelY: 0,
      // Normalized coordinates (-1 to 1)
      normalizedX: 0,
      normalizedY: 0,
      // Whether inside canvas
      isInside: false,
      // Whether pressed
      isPressed: false,
      // Whether just pressed (true for 1 frame only)
      justPressed: false,
      // Whether just released (true for 1 frame only)
      justReleased: false,
      // Velocity (pixels/frame)
      velocityX: 0,
      velocityY: 0,
      // Normalized velocity
      normalizedVelocityX: 0,
      normalizedVelocityY: 0,
    };
    
    // Previous frame position (for velocity calculation)
    this.prevPixelX = 0;
    this.prevPixelY = 0;
    this.prevTime = performance.now();

    // Cached bounding rect — updated on resize to avoid per-event layout reflow
    this._rect = canvas.getBoundingClientRect();
    this._resizeObserver = new ResizeObserver(() => {
      this._rect = canvas.getBoundingClientRect();
    });
    this._resizeObserver.observe(canvas);
    
    // Callbacks
    this.callbacks = {
      onMove: null,
      onClick: null,
      onPress: null,
      onRelease: null,
      onEnter: null,
      onLeave: null,
    };
    
    // Bind event listeners
    this._boundHandlers = {
      mouseMove: this._handleMouseMove.bind(this),
      mouseDown: this._handleMouseDown.bind(this),
      mouseUp: this._handleMouseUp.bind(this),
      mouseEnter: this._handleMouseEnter.bind(this),
      mouseLeave: this._handleMouseLeave.bind(this),
      touchStart: this._handleTouchStart.bind(this),
      touchMove: this._handleTouchMove.bind(this),
      touchEnd: this._handleTouchEnd.bind(this),
      touchCancel: this._handleTouchCancel.bind(this),
    };
    
    this._addEventListeners();
  }
  
  /**
   * Add event listeners
   * @private
   */
  _addEventListeners() {
    const { canvas } = this;
    const { _boundHandlers } = this;
    
    // Mouse events
    canvas.addEventListener('mousemove', _boundHandlers.mouseMove);
    canvas.addEventListener('mousedown', _boundHandlers.mouseDown);
    canvas.addEventListener('mouseup', _boundHandlers.mouseUp);
    canvas.addEventListener('mouseenter', _boundHandlers.mouseEnter);
    canvas.addEventListener('mouseleave', _boundHandlers.mouseLeave);
    
    // Touch events
    canvas.addEventListener('touchstart', _boundHandlers.touchStart, { passive: !this.options.preventTouchDefault });
    canvas.addEventListener('touchmove', _boundHandlers.touchMove, { passive: !this.options.preventTouchDefault });
    canvas.addEventListener('touchend', _boundHandlers.touchEnd);
    canvas.addEventListener('touchcancel', _boundHandlers.touchCancel);
  }
  
  /**
   * Remove event listeners
   * @private
   */
  _removeEventListeners() {
    const { canvas } = this;
    const { _boundHandlers } = this;
    
    canvas.removeEventListener('mousemove', _boundHandlers.mouseMove);
    canvas.removeEventListener('mousedown', _boundHandlers.mouseDown);
    canvas.removeEventListener('mouseup', _boundHandlers.mouseUp);
    canvas.removeEventListener('mouseenter', _boundHandlers.mouseEnter);
    canvas.removeEventListener('mouseleave', _boundHandlers.mouseLeave);
    
    canvas.removeEventListener('touchstart', _boundHandlers.touchStart);
    canvas.removeEventListener('touchmove', _boundHandlers.touchMove);
    canvas.removeEventListener('touchend', _boundHandlers.touchEnd);
    canvas.removeEventListener('touchcancel', _boundHandlers.touchCancel);
  }
  
  /**
   * Convert pixel coordinates to normalized coordinates
   * @private
   */
  _updateNormalizedPosition() {
    const { _rect: rect } = this;
    this.state.normalizedX = (this.state.pixelX / rect.width) * 2 - 1;
    this.state.normalizedY = -((this.state.pixelY / rect.height) * 2 - 1);
  }

  /**
   * Update velocity
   * @private
   */
  _updateVelocity() {
    if (!this.options.trackVelocity) return;

    const currentTime = performance.now();
    const deltaTime = Math.max(currentTime - this.prevTime, 1);

    this.state.velocityX = (this.state.pixelX - this.prevPixelX) / deltaTime * 16.67;
    this.state.velocityY = (this.state.pixelY - this.prevPixelY) / deltaTime * 16.67;

    const { _rect: rect } = this;
    this.state.normalizedVelocityX = this.state.velocityX / rect.width * 2;
    this.state.normalizedVelocityY = -this.state.velocityY / rect.height * 2;

    this.prevPixelX = this.state.pixelX;
    this.prevPixelY = this.state.pixelY;
    this.prevTime = currentTime;
  }

  /**
   * Update position (common processing)
   * @private
   */
  _updatePosition(clientX, clientY) {
    const rect = this._rect;
    this.state.pixelX = clientX - rect.left;
    this.state.pixelY = clientY - rect.top;
    this._updateNormalizedPosition();
    this._updateVelocity();
    
    if (this.callbacks.onMove) {
      this.callbacks.onMove(this.getPosition());
    }
  }
  
  /**
   * Mouse move handler
   * @private
   */
  _handleMouseMove(e) {
    this._updatePosition(e.clientX, e.clientY);
  }
  
  /**
   * Mouse down handler
   * @private
   */
  _handleMouseDown(e) {
    this.state.isPressed = true;
    this.state.justPressed = true;
    
    if (this.callbacks.onPress) {
      this.callbacks.onPress(this.getPosition());
    }
  }
  
  /**
   * Mouse up handler
   * @private
   */
  _handleMouseUp(e) {
    this.state.isPressed = false;
    this.state.justReleased = true;
    
    if (this.callbacks.onRelease) {
      this.callbacks.onRelease(this.getPosition());
    }
    
    if (this.callbacks.onClick) {
      this.callbacks.onClick(this.getPosition());
    }
  }
  
  /**
   * Mouse enter handler
   * @private
   */
  _handleMouseEnter(e) {
    this.state.isInside = true;
    this._updatePosition(e.clientX, e.clientY);
    
    if (this.callbacks.onEnter) {
      this.callbacks.onEnter(this.getPosition());
    }
  }
  
  /**
   * Mouse leave handler
   * @private
   */
  _handleMouseLeave(e) {
    this.state.isInside = false;
    
    if (this.callbacks.onLeave) {
      this.callbacks.onLeave(this.getPosition());
    }
  }
  
  /**
   * Touch start handler
   * @private
   */
  _handleTouchStart(e) {
    if (this.options.preventTouchDefault) {
      e.preventDefault();
    }
    
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      this._updatePosition(touch.clientX, touch.clientY);
      this.state.isInside = true;
      this.state.isPressed = true;
      this.state.justPressed = true;
      
      if (this.callbacks.onPress) {
        this.callbacks.onPress(this.getPosition());
      }
    }
  }
  
  /**
   * Touch move handler
   * @private
   */
  _handleTouchMove(e) {
    if (this.options.preventTouchDefault) {
      e.preventDefault();
    }
    
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      this._updatePosition(touch.clientX, touch.clientY);
    }
  }
  
  /**
   * Touch end handler
   * @private
   */
  _handleTouchEnd(e) {
    this.state.isInside = false;
    this.state.isPressed = false;
    this.state.justReleased = true;
    
    if (this.callbacks.onRelease) {
      this.callbacks.onRelease(this.getPosition());
    }
    
    if (this.callbacks.onClick) {
      this.callbacks.onClick(this.getPosition());
    }
  }
  
  /**
   * Touch cancel handler
   * @private
   */
  _handleTouchCancel(e) {
    this.state.isInside = false;
    this.state.isPressed = false;
  }
  
  /**
   * Frame update process (call in animation loop)
   * Resets justPressed and justReleased
   */
  update() {
    this.state.justPressed = false;
    this.state.justReleased = false;
  }
  
  // === Public API ===
  
  /**
   * Get pixel coordinates
   * @returns {{x: number, y: number}}
   */
  getPixelPosition() {
    return {
      x: this.state.pixelX,
      y: this.state.pixelY
    };
  }
  
  /**
   * Get normalized coordinates (range -1 to 1)
   * @returns {{x: number, y: number}}
   */
  getNormalizedPosition() {
    return {
      x: this.state.normalizedX,
      y: this.state.normalizedY
    };
  }
  
  /**
   * Get position (both coordinate systems)
   * @returns {{pixel: {x: number, y: number}, normalized: {x: number, y: number}}}
   */
  getPosition() {
    return {
      pixel: this.getPixelPosition(),
      normalized: this.getNormalizedPosition()
    };
  }
  
  /**
   * Get velocity (pixels/frame)
   * @returns {{x: number, y: number, magnitude: number}}
   */
  getVelocity() {
    const magnitude = Math.sqrt(
      this.state.velocityX ** 2 + this.state.velocityY ** 2
    );
    return {
      x: this.state.velocityX,
      y: this.state.velocityY,
      magnitude
    };
  }
  
  /**
   * Get normalized velocity
   * @returns {{x: number, y: number, magnitude: number}}
   */
  getNormalizedVelocity() {
    const magnitude = Math.sqrt(
      this.state.normalizedVelocityX ** 2 + this.state.normalizedVelocityY ** 2
    );
    return {
      x: this.state.normalizedVelocityX,
      y: this.state.normalizedVelocityY,
      magnitude
    };
  }
  
  /**
   * Check if pointer is inside canvas
   * @returns {boolean}
   */
  isInside() {
    return this.state.isInside;
  }
  
  /**
   * Check if pointer is pressed
   * @returns {boolean}
   */
  isPressed() {
    return this.state.isPressed;
  }
  
  /**
   * Check if pointer was just pressed this frame
   * @returns {boolean}
   */
  isJustPressed() {
    return this.state.justPressed;
  }
  
  /**
   * Check if pointer was just released this frame
   * @returns {boolean}
   */
  isJustReleased() {
    return this.state.justReleased;
  }
  
  /**
   * Get all state
   * @returns {Object}
   */
  getState() {
    return { ...this.state };
  }
  
  // === Callback Settings ===
  
  /**
   * Set callback for pointer move
   * @param {Function} callback - Callback function
   */
  onMove(callback) {
    this.callbacks.onMove = callback;
    return this;
  }
  
  /**
   * Set callback for click/tap
   * @param {Function} callback - Callback function
   */
  onClick(callback) {
    this.callbacks.onClick = callback;
    return this;
  }
  
  /**
   * Set callback for press start
   * @param {Function} callback - Callback function
   */
  onPress(callback) {
    this.callbacks.onPress = callback;
    return this;
  }
  
  /**
   * Set callback for press end
   * @param {Function} callback - Callback function
   */
  onRelease(callback) {
    this.callbacks.onRelease = callback;
    return this;
  }
  
  /**
   * Set callback for canvas enter
   * @param {Function} callback - Callback function
   */
  onEnter(callback) {
    this.callbacks.onEnter = callback;
    return this;
  }
  
  /**
   * Set callback for canvas leave
   * @param {Function} callback - Callback function
   */
  onLeave(callback) {
    this.callbacks.onLeave = callback;
    return this;
  }
  
  /**
   * Destroy resources
   */
  destroy() {
    this._removeEventListeners();
    this._resizeObserver.disconnect();
    this.canvas = null;
    this.callbacks = {};
  }
}
