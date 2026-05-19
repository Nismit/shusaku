export class Timer {
  /**
   * @param {number} offsetSeconds 
   */
  constructor(offsetSeconds = 0) {
    this.offset = offsetSeconds * 1000;
    this.startTime = null;
    this.elapsedTime = 0;
    this.running = false;
  }

  start() {
    if (!this.running) {
      this.startTime = performance.now() - this.elapsedTime; // 経過時間を考慮
      this.running = true;
    }
  }

  stop() {
    if (this.running) {
      this.elapsedTime = performance.now() - this.startTime;
      this.running = false;
    }
  }

  /**
   * @param {number} newOffsetSeconds 
   */
  reset(newOffsetSeconds = 0) {
    this.offset = newOffsetSeconds * 1000;
    this.startTime = null;
    this.elapsedTime = this.offset;
    this.running = false;
  }

  getElapsedTime() {
    if (this.running) {
      return (performance.now() - this.startTime + this.offset) / 1000;
    }
    return (this.elapsedTime + this.offset) / 1000;
  }
}