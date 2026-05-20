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

  const canUseFloat32 = gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear');
  const floatFormat = canUseFloat32 ? gl.RGBA32F : gl.RGBA16F;
  const floatType = canUseFloat32 ? gl.FLOAT : gl.HALF_FLOAT;

  const config = {
    simResolution: 512,
    dyeResolution: 512,
    velocityDissipation: 0.5,
    dyeDissipation: 1.5,   // how fast the ripple effect fades (higher = faster)
    pressureIterations: 20,
    splatSize: 15,
    splatForce: 50,
    checkerScale: 12,
    displacementScale: 0.01,
    shimmerScale: 0.0,
    chromaStrength: 0.35,
    velocityBlur: true,
  };

  const advectionShader = cgl.createShader({ fragment: advectionFrag });
  const splatShader = cgl.createShader({ fragment: splatFrag });
  const divergenceShader = cgl.createShader({ fragment: divergenceFrag });
  const pressureShader = cgl.createShader({ fragment: pressureFrag });
  const gradientShader = cgl.createShader({ fragment: gradientFrag });
  const blurShader = cgl.createShader({ fragment: blurFrag });
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
  const dyeSize = { w: config.dyeResolution, h: config.dyeResolution };

  const velocity = createDoubleFBO(simSize.w, simSize.h);
  const pressure = createDoubleFBO(simSize.w, simSize.h);
  const divergence = createFBO(simSize.w, simSize.h);
  // Dye stores displacement info: rg = flow direction, b = speed (for shimmer)
  const dye = createDoubleFBO(dyeSize.w, dyeSize.h);

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
    const force = config.splatForce;

    velocity.write.pass(splatShader, {
      uTarget: velocity.read,
      uPoint: [x, y],
      uColor: [dx * force, dy * force, 0],
      uRadius: radius,
      uAspect: aspect,
    });
    velocity.swap();

    // Dye carries velocity direction (rg) and speed magnitude (b)
    const speed = Math.sqrt(dx * dx + dy * dy);
    dye.write.pass(splatShader, {
      uTarget: dye.read,
      uPoint: [x, y],
      uColor: [dx * force, dy * force, speed * force],
      uRadius: radius,
      uAspect: aspect,
    });
    dye.swap();
  };

  const step = (dt) => {
    const simTexel = [1 / simSize.w, 1 / simSize.h];
    const dyeTexel = [1 / dyeSize.w, 1 / dyeSize.h];

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

    divergence.pass(divergenceShader, {
      uVelocity: velocity.read,
      uTexelSize: simTexel,
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, pressure.read.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    for (let i = 0; i < config.pressureIterations; i++) {
      pressure.write.pass(pressureShader, {
        uPressure: pressure.read,
        uDivergence: divergence,
        uTexelSize: simTexel,
      });
      pressure.swap();
    }

    velocity.write.pass(gradientShader, {
      uPressure: pressure.read,
      uVelocity: velocity.read,
      uTexelSize: simTexel,
    });
    velocity.swap();

    // Dye advects with the fluid and dissipates — displacement fades as ripples calm
    dye.write.pass(advectionShader, {
      uSource: dye.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.dyeDissipation,
      uTexelSize: dyeTexel,
    });
    dye.swap();
  };

  const gui = new GUI({ title: 'Stable Fluid Texture' });
  gui.add(config, 'velocityDissipation', 0, 2).name('Velocity Fade');
  gui.add(config, 'dyeDissipation', 0, 5).step(0.1).name('Ripple Fade');
  gui.add(config, 'pressureIterations', 1, 50).step(1).name('Pressure Iter');
  gui.add(config, 'splatSize', 1, 30).step(1).name('Splat Size');
  gui.add(config, 'splatForce', 1, 100).name('Splat Force');
  gui.add(config, 'checkerScale', 2, 30).step(1).name('Checker Scale');
  gui.add(config, 'displacementScale', 0, 0.025).step(0.0001).name('Displacement');
  gui.add(config, 'shimmerScale', 0, 0.1).step(0.001).name('Shimmer');
  gui.add(config, 'chromaStrength', 0, 1).step(0.01).name('Chroma');
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
      uDye: dye.read,
      uCheckerScale: config.checkerScale,
      uDispScale: config.displacementScale,
      uShimmerScale: config.shimmerScale,
      uChromaStrength: config.chromaStrength,
    });

    requestAnimationFrame(render);
  };

  render();
};
