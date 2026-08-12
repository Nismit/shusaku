import advectionFrag from './shaders/advection.frag?raw';
import splatFrag from './shaders/splat.frag?raw';
import divergenceFrag from './shaders/divergence.frag?raw';
import pressureFrag from './shaders/pressure.frag?raw';
import gradientFrag from './shaders/gradient.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import stirFrag from './shaders/stir.frag?raw';
import probeFrag from './shaders/probe.frag?raw';
import inkProbeFrag from './shaders/inkProbe.frag?raw';

// Stable Fluids solver, lifted from the Fluid Gallery / Stable Fluid sketches
// in this repo: velocity and a dye field carried by it. Quad Drift never draws
// either one — the quadtree is the only thing on screen — so both are probed
// back to the CPU instead: the velocity to carry the ink sources around, the
// dye to tell the tree where to split.
//
// Coordinates are simulation UV: 0..1 on both axes, y up, square grid.

// Velocity that maps to the ends of the encoded range. Anything faster clips,
// which only means a source briefly stops accelerating — far better than
// wasting most of the 16 bits on speeds the solver never reaches.
const VELOCITY_RANGE = 4.0;

export const createFluid = (cgl, options = {}) => {
  const gl = cgl.gl;
  const size = options.resolution ?? 256;
  const probeRes = options.probeResolution ?? 64;
  // The ink carries the shape of the piece, so it runs at a finer grid than the
  // velocity does: advection is bilinear, and a streak this thin smears out
  // within a second or two at the velocity field's resolution.
  const inkFieldRes = options.inkResolution ?? 512;
  const inkProbeRes = options.inkProbeResolution ?? 256;

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
  const inkProbeShader = cgl.createShader({ fragment: inkProbeFrag });

  const velocity = cgl.createPingPongFramebuffer(size, size, fieldOptions);
  const pressure = cgl.createPingPongFramebuffer(size, size, fieldOptions);
  const divergence = cgl.createFramebuffer(size, size, null, fieldOptions);
  const ink = cgl.createPingPongFramebuffer(inkFieldRes, inkFieldRes, fieldOptions);

  velocity.clear(0, 0, 0, 1);
  pressure.clear(0, 0, 0, 1);
  ink.clear(0, 0, 0, 1);

  const texel = [1 / size, 1 / size];
  const inkTexel = [1 / inkFieldRes, 1 / inkFieldRes];

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

  const addInk = (x, y, amount, radius, aspect = 1) => {
    ink.write.pass(splatShader, {
      uTarget: ink.read,
      uPoint: [x, y],
      uColor: [amount, 0, 0],
      uRadius: Math.max(radius * radius, 1e-6),
      uAspect: aspect,
    });
    ink.swap();
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

  const step = (dt, dissipation, pressureIterations, inkFade) => {
    velocity.write.pass(advectionShader, {
      uSource: velocity.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: dissipation,
      uTexelSize: texel,
    });
    velocity.swap();

    // Separable Gaussian, standing in for viscosity: it keeps the field smooth
    // enough that the probe's downsample is not aliasing sharp vortices.
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

    ink.write.pass(advectionShader, {
      uSource: ink.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: inkFade,
      uTexelSize: inkTexel,
    });
    ink.swap();

    velocityProbe.capture();
    inkProbe.capture();
  };

  // --- Readback ---------------------------------------------------------------

  // Renders a small RGBA8 copy of a field and reads it back through a pair of
  // pixel buffers behind a fence. Reading straight into a typed array would
  // stall the pipeline every frame waiting on the GPU; instead each slot issues
  // its read one frame and collects it the next, so the CPU side runs on a
  // field that is a frame or two stale and nothing blocks.
  const createProbe = (res, capture, decode) => {
    const fbo = cgl.createFramebuffer(res, res, null, { minFilter: gl.NEAREST, magFilter: gl.NEAREST });
    const byteCount = res * res * 4;
    const pixels = new Uint8Array(byteCount);

    const slots = [0, 1].map(() => {
      const pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, byteCount, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return { pbo, sync: null };
    });
    let slotIndex = 0;

    return {
      capture() { capture(fbo); },

      readback() {
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
            decode(pixels);
          }
        }

        fbo.bind();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
        gl.readPixels(0, 0, res, res, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        fbo.unbind();

        slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      },

      // Blocking read, for warm-up only: the first frame should already have a
      // developed field to work from rather than a frame or two of dead air.
      readbackSync() {
        fbo.bind();
        gl.readPixels(0, 0, res, res, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        fbo.unbind();
        decode(pixels);
      },
    };
  };

  // --- Velocity field ---------------------------------------------------------

  const flowField = new Float32Array(probeRes * probeRes * 2);

  const velocityProbe = createProbe(
    probeRes,
    (fbo) => fbo.pass(probeShader, { uVelocity: velocity.read, uRange: VELOCITY_RANGE }),
    (pixels) => {
      for (let i = 0, p = 0; i < flowField.length; i += 2, p += 4) {
        // 16-bit fixed point, then back out of the 0..1 encoding.
        const x = (pixels[p] + pixels[p + 1] / 255) / 255;
        const y = (pixels[p + 2] + pixels[p + 3] / 255) / 255;
        flowField[i] = (x * 2 - 1) * VELOCITY_RANGE;
        flowField[i + 1] = (y * 2 - 1) * VELOCITY_RANGE;
      }
    },
  );

  // Bilinear sample of the probed velocity. Out of range coordinates clamp,
  // which matches the solver's own walls.
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
    out[0] = lerp(lerp(flowField[a], flowField[b], tx), lerp(flowField[c], flowField[d], tx), ty);
    out[1] = lerp(lerp(flowField[a + 1], flowField[b + 1], tx), lerp(flowField[c + 1], flowField[d + 1], tx), ty);
    return out;
  };

  // --- Ink field --------------------------------------------------------------

  // Max pyramid over the ink. The quadtree asks "is there ink anywhere in this
  // cell", for cells running from a third of the frame down to a few pixels;
  // the pyramid answers either size in a handful of lookups, and unlike
  // sampling the cell centre, a trail clipping one corner still splits it.
  const inkLevels = [];
  for (let res = inkProbeRes; res >= 1; res >>= 1) inkLevels.push(new Float32Array(res * res));

  const inkProbe = createProbe(
    inkProbeRes,
    (fbo) => fbo.pass(inkProbeShader, { uInk: ink.read }),
    (pixels) => {
      const base = inkLevels[0];
      for (let i = 0, p = 0; i < base.length; i++, p += 4) {
        base[i] = (pixels[p] + pixels[p + 1] / 255) / 255;
      }

      for (let level = 1; level < inkLevels.length; level++) {
        const src = inkLevels[level - 1];
        const dst = inkLevels[level];
        const srcRes = inkProbeRes >> (level - 1);
        const dstRes = inkProbeRes >> level;
        for (let y = 0; y < dstRes; y++) {
          for (let x = 0; x < dstRes; x++) {
            const a = (y * 2) * srcRes + x * 2;
            const b = (y * 2 + 1) * srcRes + x * 2;
            dst[y * dstRes + x] = Math.max(src[a], src[a + 1], src[b], src[b + 1]);
          }
        }
      }
    },
  );

  // Highest ink value anywhere in the UV rectangle.
  const inkMaxIn = (u0, v0, u1, v1) => {
    const span = Math.max(u1 - u0, v1 - v0);
    // Pick the level where the rectangle spans one or two texels, so the loop
    // below stays at a handful of lookups whatever the cell size.
    let level = Math.floor(Math.log2(Math.max(span * inkProbeRes, 1)));
    if (level > inkLevels.length - 1) level = inkLevels.length - 1;

    const res = inkProbeRes >> level;
    const data = inkLevels[level];
    const clamp = (v) => Math.min(Math.max(v, 0), res - 1);
    const x0 = clamp(Math.floor(u0 * res));
    const x1 = clamp(Math.floor(u1 * res));
    const y0 = clamp(Math.floor(v0 * res));
    const y1 = clamp(Math.floor(v1 * res));

    let max = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const v = data[y * res + x];
        if (v > max) max = v;
      }
    }
    return max;
  };

  const readback = () => {
    velocityProbe.readback();
    inkProbe.readback();
  };

  const readbackSync = () => {
    velocityProbe.readbackSync();
    inkProbe.readbackSync();
  };

  return { addForce, addInk, stir, step, readback, readbackSync, velocityAt, inkMaxIn, resolution: size };
};
