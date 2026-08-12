import advectionFrag from './shaders/advection.frag?raw';
import splatFrag from './shaders/splat.frag?raw';
import divergenceFrag from './shaders/divergence.frag?raw';
import pressureFrag from './shaders/pressure.frag?raw';
import gradientFrag from './shaders/gradient.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import stirFrag from './shaders/stir.frag?raw';
import probeFrag from './shaders/probe.frag?raw';

// Velocity-only Stable Fluids solver, lifted from the Fluid Gallery / Stable
// Fluid sketches in this repo. Quad Drift never draws the fluid, so the dye
// field those sketches carry is dropped — all that survives is the velocity
// field, plus a probe pass that copies it back to the CPU, where the quadtree
// lives.
//
// Coordinates are simulation UV: 0..1 on both axes, y up, square grid.

// Velocity that maps to the ends of the encoded range. Anything faster clips,
// which only means a drifter briefly stops accelerating — far better than
// wasting most of the 16 bits on speeds the solver never reaches.
const VELOCITY_RANGE = 4.0;

export const createFluid = (cgl, options = {}) => {
  const gl = cgl.gl;
  const size = options.resolution ?? 256;
  const probeRes = options.probeResolution ?? 64;

  const canUseFloat32 = gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear');
  const fieldOptions = {
    internalFormat: canUseFloat32 ? gl.RGBA32F : gl.RGBA16F,
    format: gl.RGBA,
    type: canUseFloat32 ? gl.FLOAT : gl.HALF_FLOAT,
    minFilter: gl.LINEAR,
    magFilter: gl.LINEAR,
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE,
  };

  const advectionShader = cgl.createShader({ fragment: advectionFrag });
  const splatShader = cgl.createShader({ fragment: splatFrag });
  const divergenceShader = cgl.createShader({ fragment: divergenceFrag });
  const pressureShader = cgl.createShader({ fragment: pressureFrag });
  const gradientShader = cgl.createShader({ fragment: gradientFrag });
  const blurShader = cgl.createShader({ fragment: blurFrag });
  const stirShader = cgl.createShader({ fragment: stirFrag });
  const probeShader = cgl.createShader({ fragment: probeFrag });

  const velocity = cgl.createPingPongFramebuffer(size, size, fieldOptions);
  const pressure = cgl.createPingPongFramebuffer(size, size, fieldOptions);
  const divergence = cgl.createFramebuffer(size, size, null, fieldOptions);

  // NEAREST: the probe is read back byte for byte, never sampled by the GPU.
  const probeFBO = cgl.createFramebuffer(probeRes, probeRes, null, {
    minFilter: gl.NEAREST,
    magFilter: gl.NEAREST,
  });

  velocity.clear(0, 0, 0, 1);
  pressure.clear(0, 0, 0, 1);

  const texel = [1 / size, 1 / size];

  // --- Simulation -------------------------------------------------------------

  // Adds `fx, fy` (UV per second) to the velocity field, falling off as a
  // Gaussian of e-fold radius `radius`. `aspect` shapes the blob in screen
  // terms; the grid itself is square.
  const addForce = (x, y, fx, fy, radius, aspect = 1) => {
    velocity.write.pass(splatShader, {
      uTarget: velocity.read,
      uPoint: [x, y],
      uColor: [fx, fy, 0],
      uRadius: Math.max(radius * radius, 1e-6),
      uAspect: aspect,
    });
    velocity.swap();
  };

  // Adds one step's worth of the vortex-lattice forcing over the whole field.
  // `amount` is UV per second squared; `phaseA`/`phaseB` slide the two lattices.
  const stir = (amount, scale, phaseA, phaseB) => {
    velocity.write.pass(stirShader, {
      uVelocity: velocity.read,
      uAmount: amount,
      uScale: scale,
      uPhaseA: phaseA,
      uPhaseB: phaseB,
    });
    velocity.swap();
  };

  const step = (dt, dissipation, pressureIterations) => {
    velocity.write.pass(advectionShader, {
      uSource: velocity.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: dissipation,
      uTexelSize: texel,
    });
    velocity.swap();

    // Separable Gaussian, standing in for viscosity: it keeps the field smooth
    // enough that the probe's 64x64 downsample is not aliasing sharp vortices.
    velocity.write.pass(blurShader, { uTexture: velocity.read, uTexelSize: texel, uDirection: [1, 0] });
    velocity.swap();
    velocity.write.pass(blurShader, { uTexture: velocity.read, uTexelSize: texel, uDirection: [0, 1] });
    velocity.swap();

    divergence.pass(divergenceShader, { uVelocity: velocity.read, uTexelSize: texel });

    pressure.read.clear(0, 0, 0, 1);
    for (let i = 0; i < pressureIterations; i++) {
      pressure.write.pass(pressureShader, {
        uPressure: pressure.read,
        uDivergence: divergence,
        uTexelSize: texel,
      });
      pressure.swap();
    }

    velocity.write.pass(gradientShader, {
      uPressure: pressure.read,
      uVelocity: velocity.read,
      uTexelSize: texel,
    });
    velocity.swap();

    probeFBO.pass(probeShader, { uVelocity: velocity.read, uRange: VELOCITY_RANGE });
  };

  // --- Readback ---------------------------------------------------------------

  const byteCount = probeRes * probeRes * 4;
  const pixels = new Uint8Array(byteCount);
  const field = new Float32Array(probeRes * probeRes * 2);

  const decode = () => {
    for (let i = 0, p = 0; i < field.length; i += 2, p += 4) {
      // 16-bit fixed point, then back out of the 0..1 encoding.
      const x = (pixels[p] + pixels[p + 1] / 255) / 255;
      const y = (pixels[p + 2] + pixels[p + 3] / 255) / 255;
      field[i] = (x * 2 - 1) * VELOCITY_RANGE;
      field[i + 1] = (y * 2 - 1) * VELOCITY_RANGE;
    }
  };

  // Two pixel buffers in rotation. Reading the probe straight into a typed
  // array would stall the pipeline every frame waiting for the GPU to catch up;
  // instead each slot issues its read one frame and collects it the next, so
  // the drifters run on a field that is a frame or two stale and nothing blocks.
  const slots = [0, 1].map(() => {
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, byteCount, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return { pbo, sync: null };
  });
  let slotIndex = 0;

  const readback = () => {
    const slot = slots[slotIndex];
    slotIndex = (slotIndex + 1) % slots.length;

    if (slot.sync) {
      const status = gl.clientWaitSync(slot.sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return; // still in flight; keep last field
      gl.deleteSync(slot.sync);
      slot.sync = null;

      if (status !== gl.WAIT_FAILED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        decode();
      }
    }

    probeFBO.bind();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
    gl.readPixels(0, 0, probeRes, probeRes, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    probeFBO.unbind();

    slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  };

  // Blocking read, for warm-up only: the first frame should already have a
  // developed field to steer by rather than a frame or two of dead air.
  const readbackSync = () => {
    probeFBO.bind();
    gl.readPixels(0, 0, probeRes, probeRes, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    probeFBO.unbind();
    decode();
  };

  // Bilinear sample of the probed field. Out of range coordinates clamp, which
  // matches the solver's own walls.
  const velocityAt = (x, y, out) => {
    const fx = Math.min(Math.max(x, 0), 1) * (probeRes - 1);
    const fy = Math.min(Math.max(y, 0), 1) * (probeRes - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, probeRes - 1);
    const y1 = Math.min(y0 + 1, probeRes - 1);
    const tx = fx - x0;
    const ty = fy - y0;

    const at = (ix, iy) => (iy * probeRes + ix) * 2;
    const a = at(x0, y0);
    const b = at(x1, y0);
    const c = at(x0, y1);
    const d = at(x1, y1);

    const lerp = (p, q, t) => p + (q - p) * t;
    out[0] = lerp(lerp(field[a], field[b], tx), lerp(field[c], field[d], tx), ty);
    out[1] = lerp(lerp(field[a + 1], field[b + 1], tx), lerp(field[c + 1], field[d + 1], tx), ty);
    return out;
  };

  return { addForce, stir, step, readback, readbackSync, velocityAt, resolution: size };
};
