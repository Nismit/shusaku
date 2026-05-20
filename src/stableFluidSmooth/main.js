import { chottoGL } from '../libs/esChottoGL.js';
import { PointerInput } from '../libs/PointerInput.js';
import GUI from '../libs/lil-gui.esm.min.js';

import advectionFrag from './shaders/advection.frag?raw';
import splatFrag from './shaders/splat.frag?raw';
import divergenceFrag from './shaders/divergence.frag?raw';
import pressureFrag from './shaders/pressure.frag?raw';
import gradientFrag from './shaders/gradient.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import displayFrag from './shaders/display.frag?raw';

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const cgl = chottoGL(canvas, {
    extensions: ['OES_texture_float_linear', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float'],
  });
  cgl.fitWindow();

  const gl = cgl.gl;

  // Float texture format (fallback for iOS)
  const canUseFloat32 = gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear');
  const floatFormat = canUseFloat32 ? gl.RGBA32F : gl.RGBA16F;
  const floatType = canUseFloat32 ? gl.FLOAT : gl.HALF_FLOAT;

  // --- Parameters ---
  const config = {
    simResolution: 512,
    dyeResolution: 512,
    velocityDissipation: 0.5,
    dyeDissipation: 0.97,
    pressureIterations: 20,
    splatSize: 15,
    splatForce: 50,
    colorful: false,
    color: '#00bcd4',
    velocityBlur: true,
  };

  const hexToRgb = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  };

  // --- Shaders ---
  const advectionShader = cgl.createShader({ fragment: advectionFrag });
  const splatShader = cgl.createShader({ fragment: splatFrag });
  const divergenceShader = cgl.createShader({ fragment: divergenceFrag });
  const pressureShader = cgl.createShader({ fragment: pressureFrag });
  const gradientShader = cgl.createShader({ fragment: gradientFrag });
  const blurShader = cgl.createShader({ fragment: blurFrag });
  const displayShader = cgl.createShader({ fragment: displayFrag });

  // --- Create FBOs ---
  const createFBO = (w, h) => {
    return cgl.createFramebuffer(w, h, null, {
      internalFormat: floatFormat,
      format: gl.RGBA,
      type: floatType,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
  };

  const createDoubleFBO = (w, h) => {
    return {
      read: createFBO(w, h),
      write: createFBO(w, h),
      swap() { [this.read, this.write] = [this.write, this.read]; }
    };
  };

  let simSize = { w: config.simResolution, h: config.simResolution };
  let dyeSize = { w: config.dyeResolution, h: config.dyeResolution };

  let velocity = createDoubleFBO(simSize.w, simSize.h);
  let pressure = createDoubleFBO(simSize.w, simSize.h);
  let divergence = createFBO(simSize.w, simSize.h);
  let dye = createDoubleFBO(dyeSize.w, dyeSize.h);

  // --- Pointer input (mouse + touch) ---
  const pointer = new PointerInput(canvas);

  // Smoothed velocity state
  const smoothedVelocity = { x: 0, y: 0 };
  const smoothing = 0.2;
  const decay = 0.85;

  pointer.onMove(() => {
    const rawVel = pointer.getNormalizedVelocity();
    // Convert from -1..1 to 0..1 space and apply smoothing
    smoothedVelocity.x += (rawVel.x * 0.5 - smoothedVelocity.x) * smoothing;
    smoothedVelocity.y += (rawVel.y * 0.5 - smoothedVelocity.y) * smoothing;
  });

  // --- Random color ---
  const randomColor = () => {
    const hue = Math.random() * 360;
    const s = 0.7, l = 0.5;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [(r + m), (g + m), (b + m)];
  };

  let currentColor = hexToRgb(config.color);
  let colorTimer = 0;

  // --- Splat function ---
  const splat = (x, y, dx, dy, color) => {
    const aspect = canvas.width / canvas.height;

    const radius = config.splatSize * 0.0002;

    // Velocity splat
    velocity.write.pass(splatShader, {
      uTarget: velocity.read,
      uPoint: [x, y],
      uColor: [dx * config.splatForce, dy * config.splatForce, 0],
      uRadius: radius,
      uAspect: aspect,
    });
    velocity.swap();

    // Dye splat
    dye.write.pass(splatShader, {
      uTarget: dye.read,
      uPoint: [x, y],
      uColor: color,
      uRadius: radius,
      uAspect: aspect,
    });
    dye.swap();
  };

  // --- Simulation step ---
  const step = (dt) => {
    const simTexel = [1 / simSize.w, 1 / simSize.h];
    const dyeTexel = [1 / dyeSize.w, 1 / dyeSize.h];

    // Advect velocity
    velocity.write.pass(advectionShader, {
      uSource: velocity.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.velocityDissipation,
      uTexelSize: simTexel,
    });
    velocity.swap();

    // Velocity blur (separable Gaussian)
    if (config.velocityBlur) {
      // Horizontal pass
      velocity.write.pass(blurShader, {
        uTexture: velocity.read,
        uTexelSize: simTexel,
        uDirection: [1, 0],
      });
      velocity.swap();

      // Vertical pass
      velocity.write.pass(blurShader, {
        uTexture: velocity.read,
        uTexelSize: simTexel,
        uDirection: [0, 1],
      });
      velocity.swap();
    }

    // Divergence
    divergence.pass(divergenceShader, {
      uVelocity: velocity.read,
      uTexelSize: simTexel,
    });

    // Clear pressure
    gl.bindFramebuffer(gl.FRAMEBUFFER, pressure.read.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Pressure solve (Jacobi iteration)
    for (let i = 0; i < config.pressureIterations; i++) {
      pressure.write.pass(pressureShader, {
        uPressure: pressure.read,
        uDivergence: divergence,
        uTexelSize: simTexel,
      });
      pressure.swap();
    }

    // Gradient subtract
    velocity.write.pass(gradientShader, {
      uPressure: pressure.read,
      uVelocity: velocity.read,
      uTexelSize: simTexel,
    });
    velocity.swap();

    // Advect dye
    dye.write.pass(advectionShader, {
      uSource: dye.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.dyeDissipation,
      uTexelSize: dyeTexel,
    });
    dye.swap();
  };

  // --- GUI ---
  const gui = new GUI({ title: 'Stable Fluid Smooth' });
  gui.add(config, 'velocityDissipation', 0, 2).name('Velocity Fade');
  gui.add(config, 'dyeDissipation', 0.9, 1).step(0.001).name('Dye Fade');
  gui.add(config, 'pressureIterations', 1, 50).step(1).name('Pressure Iter');
  gui.add(config, 'splatSize', 1, 30).step(1).name('Splat Size');
  gui.add(config, 'splatForce', 1, 100).name('Splat Force');
  const colorController = gui.addColor(config, 'color').name('Color').onChange(() => {
    currentColor = hexToRgb(config.color);
  });
  gui.add(config, 'colorful').name('Colorful').onChange((value) => {
    if (value) {
      colorController.disable();
    } else {
      colorController.enable();
      currentColor = hexToRgb(config.color);
    }
  });
  gui.add(config, 'velocityBlur').name('Velocity Blur');
  gui.close();

  // --- Render loop ---
  let lastTime = performance.now();

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    // Decay smoothed velocity when not moving
    smoothedVelocity.x *= decay;
    smoothedVelocity.y *= decay;

    // Color change
    colorTimer += dt;
    if (config.colorful && colorTimer > 0.5) {
      currentColor = randomColor();
      colorTimer = 0;
    }

    // Splat if moving and inside canvas
    const speed = Math.sqrt(smoothedVelocity.x ** 2 + smoothedVelocity.y ** 2);
    if (speed > 0.0001 && pointer.isInside()) {
      const pos = pointer.getNormalizedPosition();
      // Convert from -1..1 to 0..1
      const x = (pos.x + 1) * 0.5;
      const y = (pos.y + 1) * 0.5;
      splat(
        x,
        y,
        smoothedVelocity.x,
        smoothedVelocity.y,
        currentColor
      );
    }

    // Simulation
    step(dt);

    // Display
    cgl.pass(displayShader, {
      uTexture: dye.read,
    });

    requestAnimationFrame(render);
  };

  render();
};
