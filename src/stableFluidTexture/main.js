import { chottoGL } from '../libs/esChottoGL.js';
import { PointerInput } from '../libs/PointerInput.js';
import GUI from '../libs/lil-gui.esm.min.js';

import advectionFrag from './shaders/advection.frag?raw';
import uvAdvectionFrag from './shaders/uvAdvection.frag?raw';
import splatFrag from './shaders/splat.frag?raw';
import divergenceFrag from './shaders/divergence.frag?raw';
import pressureFrag from './shaders/pressure.frag?raw';
import gradientFrag from './shaders/gradient.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import uvInitFrag from './shaders/uvInit.frag?raw';
import restoreFrag from './shaders/restore.frag?raw';
import displayFrag from './shaders/display.frag?raw';

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const cgl = chottoGL(canvas, {
    extensions: ['OES_texture_float_linear', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float'],
  });
  cgl.fitWindow();

  const gl = cgl.gl;

  const canUseFloat32 = gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear');
  const floatFormat = canUseFloat32 ? gl.RGBA32F : gl.RGBA16F;
  const floatType = canUseFloat32 ? gl.FLOAT : gl.HALF_FLOAT;

  const config = {
    simResolution: 512,
    uvResolution: 512,
    velocityDissipation: 0.5,
    restoreSpeed: 0.8,
    pressureIterations: 20,
    splatSize: 15,
    splatForce: 50,
    checkerScale: 12,
    velocityBlur: true,
  };

  const advectionShader = cgl.createShader({ fragment: advectionFrag });
  const uvAdvectionShader = cgl.createShader({ fragment: uvAdvectionFrag });
  const splatShader = cgl.createShader({ fragment: splatFrag });
  const divergenceShader = cgl.createShader({ fragment: divergenceFrag });
  const pressureShader = cgl.createShader({ fragment: pressureFrag });
  const gradientShader = cgl.createShader({ fragment: gradientFrag });
  const blurShader = cgl.createShader({ fragment: blurFrag });
  const uvInitShader = cgl.createShader({ fragment: uvInitFrag });
  const restoreShader = cgl.createShader({ fragment: restoreFrag });
  const displayShader = cgl.createShader({ fragment: displayFrag });

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

  const simSize = { w: config.simResolution, h: config.simResolution };
  const uvSize = { w: config.uvResolution, h: config.uvResolution };

  const velocity = createDoubleFBO(simSize.w, simSize.h);
  const pressure = createDoubleFBO(simSize.w, simSize.h);
  const divergence = createFBO(simSize.w, simSize.h);
  const uvField = createDoubleFBO(uvSize.w, uvSize.h);

  // Initialize UV field: each pixel stores its own UV coordinate (identity mapping)
  uvField.read.pass(uvInitShader, {});
  uvField.write.pass(uvInitShader, {});

  const pointer = new PointerInput(canvas);

  const smoothedVelocity = { x: 0, y: 0 };
  const smoothing = 0.2;
  const decay = 0.85;

  pointer.onMove(() => {
    const rawVel = pointer.getNormalizedVelocity();
    smoothedVelocity.x += (rawVel.x * 0.5 - smoothedVelocity.x) * smoothing;
    smoothedVelocity.y += (rawVel.y * 0.5 - smoothedVelocity.y) * smoothing;
  });

  const splat = (x, y, dx, dy) => {
    const aspect = canvas.width / canvas.height;
    const radius = config.splatSize * 0.0002;

    velocity.write.pass(splatShader, {
      uTarget: velocity.read,
      uPoint: [x, y],
      uColor: [dx * config.splatForce, dy * config.splatForce, 0],
      uRadius: radius,
      uAspect: aspect,
    });
    velocity.swap();
  };

  const step = (dt) => {
    const simTexel = [1 / simSize.w, 1 / simSize.h];
    const uvTexel = [1 / uvSize.w, 1 / uvSize.h];

    // Advect velocity
    velocity.write.pass(advectionShader, {
      uSource: velocity.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.velocityDissipation,
      uTexelSize: simTexel,
    });
    velocity.swap();

    if (config.velocityBlur) {
      velocity.write.pass(blurShader, {
        uTexture: velocity.read,
        uTexelSize: simTexel,
        uDirection: [1, 0],
      });
      velocity.swap();

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

    // Advect UV field using the current velocity
    uvField.write.pass(uvAdvectionShader, {
      uSource: uvField.read,
      uVelocity: velocity.read,
      uDt: dt,
      uTexelSize: uvTexel,
    });
    uvField.swap();

    // Restore UV field toward identity over time (rubber-sheet spring-back)
    const restoreRate = 1.0 - Math.exp(-config.restoreSpeed * dt);
    uvField.write.pass(restoreShader, {
      uUVField: uvField.read,
      uRestoreRate: restoreRate,
    });
    uvField.swap();
  };

  const gui = new GUI({ title: 'Stable Fluid Texture' });
  gui.add(config, 'velocityDissipation', 0, 2).name('Velocity Fade');
  gui.add(config, 'restoreSpeed', 0, 5).step(0.05).name('Restore Speed');
  gui.add(config, 'pressureIterations', 1, 50).step(1).name('Pressure Iter');
  gui.add(config, 'splatSize', 1, 30).step(1).name('Splat Size');
  gui.add(config, 'splatForce', 1, 100).name('Splat Force');
  gui.add(config, 'checkerScale', 2, 30).step(1).name('Checker Scale');
  gui.add(config, 'velocityBlur').name('Velocity Blur');
  gui.close();

  let lastTime = performance.now();

  const render = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    smoothedVelocity.x *= decay;
    smoothedVelocity.y *= decay;

    const speed = Math.sqrt(smoothedVelocity.x ** 2 + smoothedVelocity.y ** 2);
    if (speed > 0.0001 && pointer.isInside()) {
      const pos = pointer.getNormalizedPosition();
      const x = (pos.x + 1) * 0.5;
      const y = (pos.y + 1) * 0.5;
      splat(x, y, smoothedVelocity.x, smoothedVelocity.y);
    }

    step(dt);

    cgl.pass(displayShader, {
      uUVField: uvField.read,
      uCheckerScale: config.checkerScale,
    });

    requestAnimationFrame(render);
  };

  render();
};
