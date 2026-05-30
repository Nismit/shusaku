import { chottoGL } from '../libs/esChottoGL.js';
import { PointerInput } from '../libs/PointerInput.js';
import GUI from '../libs/lil-gui.esm.min.js';

import golInitFrag from './shaders/gol_init.frag?raw';
import golFrag from './shaders/gol.frag?raw';
import golInjectFrag from './shaders/gol_inject.frag?raw';
import golDyeFrag from './shaders/gol_dye.frag?raw';
import golPaintFrag from './shaders/gol_paint.frag?raw';
import advectionFrag from './shaders/advection.frag?raw';
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

  const canUseFloat32 =
    gl.getExtension('EXT_color_buffer_float') && gl.getExtension('OES_texture_float_linear');
  const floatFormat = canUseFloat32 ? gl.RGBA32F : gl.RGBA16F;
  const floatType   = canUseFloat32 ? gl.FLOAT : gl.HALF_FLOAT;

  // --- Config ---
  const config = {
    golResolution: 200,
    golInterval: 8,
    velocityStrength: 3.0,
    dyeStrength: 2.5,
    dyeDissipation: 3.5,
    pressureIterations: 20,
    showCells: true,
    cellBrightness: 1.2,
    brushSize: 5,
    birthColor: '#00e5ff',
    deathColor: '#ff6d00',
  };

  const hexToRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];

  // --- FBO helpers ---
  const createFBO = (w, h, filtering = gl.LINEAR) =>
    cgl.createFramebuffer(w, h, null, {
      internalFormat: floatFormat,
      format: gl.RGBA,
      type: floatType,
      minFilter: filtering,
      magFilter: filtering,
    });

  const createDoubleFBO = (w, h, filtering = gl.LINEAR) => ({
    read:  createFBO(w, h, filtering),
    write: createFBO(w, h, filtering),
    swap() { [this.read, this.write] = [this.write, this.read]; },
  });

  const simSize = { w: 512, h: 512 };
  const golSize = { w: config.golResolution, h: config.golResolution };

  // GoL uses NEAREST to keep cell edges sharp
  let gol      = createDoubleFBO(golSize.w, golSize.h, gl.NEAREST);
  let velocity = createDoubleFBO(simSize.w, simSize.h);
  let pressure = createDoubleFBO(simSize.w, simSize.h);
  let divergence = createFBO(simSize.w, simSize.h);
  let dye      = createDoubleFBO(simSize.w, simSize.h);

  // --- Shaders ---
  const golInitShader   = cgl.createShader({ fragment: golInitFrag });
  const golShader       = cgl.createShader({ fragment: golFrag });
  const golInjectShader = cgl.createShader({ fragment: golInjectFrag });
  const golDyeShader    = cgl.createShader({ fragment: golDyeFrag });
  const golPaintShader  = cgl.createShader({ fragment: golPaintFrag });
  const advectionShader = cgl.createShader({ fragment: advectionFrag });
  const divergenceShader = cgl.createShader({ fragment: divergenceFrag });
  const pressureShader  = cgl.createShader({ fragment: pressureFrag });
  const gradientShader  = cgl.createShader({ fragment: gradientFrag });
  const blurShader      = cgl.createShader({ fragment: blurFrag });
  const displayShader   = cgl.createShader({ fragment: displayFrag });

  // --- GoL initialization ---
  const initGol = () => {
    gol.read.pass(golInitShader, { uSeed: Math.random() * 1000 });
  };
  initGol();

  // --- GoL step ---
  const stepGol = () => {
    gol.write.pass(golShader, {
      uGolState: gol.read,
      uTexelSize: [1 / golSize.w, 1 / golSize.h],
    });
    gol.swap();
  };

  // --- Inject GoL events into fluid ---
  const injectFromGol = () => {
    const golTexel = [1 / golSize.w, 1 / golSize.h];

    velocity.write.pass(golInjectShader, {
      uGolState: gol.read,
      uVelocity: velocity.read,
      uGolTexelSize: golTexel,
      uVelocityStrength: config.velocityStrength,
    });
    velocity.swap();

    dye.write.pass(golDyeShader, {
      uGolState: gol.read,
      uDye: dye.read,
      uDyeStrength: config.dyeStrength,
      uBirthColor: hexToRgb(config.birthColor),
      uDeathColor: hexToRgb(config.deathColor),
    });
    dye.swap();
  };

  // --- Fluid simulation step ---
  const stepFluid = (dt) => {
    const simTexel = [1 / simSize.w, 1 / simSize.h];

    // Self-advect velocity
    velocity.write.pass(advectionShader, {
      uSource: velocity.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: 0.5,
      uTexelSize: simTexel,
    });
    velocity.swap();

    // Smooth velocity (separable Gaussian)
    velocity.write.pass(blurShader, {
      uTexture: velocity.read, uTexelSize: simTexel, uDirection: [1, 0],
    });
    velocity.swap();
    velocity.write.pass(blurShader, {
      uTexture: velocity.read, uTexelSize: simTexel, uDirection: [0, 1],
    });
    velocity.swap();

    // Pressure projection
    divergence.pass(divergenceShader, {
      uVelocity: velocity.read, uTexelSize: simTexel,
    });

    pressure.read.clear(0, 0, 0, 0);

    for (let i = 0; i < config.pressureIterations; i++) {
      pressure.write.pass(pressureShader, {
        uPressure: pressure.read, uDivergence: divergence, uTexelSize: simTexel,
      });
      pressure.swap();
    }

    velocity.write.pass(gradientShader, {
      uPressure: pressure.read, uVelocity: velocity.read, uTexelSize: simTexel,
    });
    velocity.swap();

    // Advect dye
    dye.write.pass(advectionShader, {
      uSource: dye.read,
      uVelocity: velocity.read,
      uDt: dt,
      uDissipation: config.dyeDissipation,
      uTexelSize: simTexel,
    });
    dye.swap();
  };

  // --- Pointer: paint GoL cells on click/drag ---
  const pointer = new PointerInput(canvas);

  pointer.onMove(() => {
    if (!pointer.isInside() || !pointer.isPressed()) return;
    const pos = pointer.getNormalizedPosition();
    const x = (pos.x + 1) * 0.5;
    const y = (pos.y + 1) * 0.5;
    const radius = (config.brushSize + 0.5) / golSize.w;

    gol.write.pass(golPaintShader, {
      uGolState: gol.read,
      uPoint: [x, y],
      uRadius: radius,
      uPaint: 1.0,
    });
    gol.swap();
  });

  // --- GUI ---
  const gui = new GUI({ title: 'Game of Life + Fluid' });
  gui.add(config, 'golInterval', 1, 30).step(1).name('GoL Speed');
  gui.add(config, 'velocityStrength', 0, 8).step(0.1).name('Velocity Strength');
  gui.add(config, 'dyeStrength', 0, 5).step(0.1).name('Dye Strength');
  gui.add(config, 'dyeDissipation', 0, 5).step(0.1).name('Dye Fade');
  gui.add(config, 'pressureIterations', 1, 50).step(1).name('Pressure Iter');
  gui.add(config, 'showCells').name('Show Cells');
  gui.add(config, 'cellBrightness', 0, 3).step(0.1).name('Cell Brightness');
  gui.add(config, 'brushSize', 1, 15).step(1).name('Brush Size');
  gui.addColor(config, 'birthColor').name('Birth Color');
  gui.addColor(config, 'deathColor').name('Death Color');
  gui.add({
    reset() {
      initGol();
      velocity.read.clear(0, 0, 0, 0);
      velocity.write.clear(0, 0, 0, 0);
      dye.read.clear(0, 0, 0, 0);
      dye.write.clear(0, 0, 0, 0);
    }
  }, 'reset').name('Reset');
  gui.close();

  // --- Render loop ---
  let lastTime = performance.now();
  let frameCount = 0;

  const render = () => {
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime  = now;

    if (frameCount % config.golInterval === 0) {
      stepGol();
      injectFromGol();
    }

    stepFluid(dt);

    cgl.pass(displayShader, {
      uDye: dye.read,
      uGolState: gol.read,
      uGolTexelSize: [1 / golSize.w, 1 / golSize.h],
      uCellBrightness: config.cellBrightness,
      uShowCells: config.showCells ? 1.0 : 0.0,
    });

    pointer.update();
    frameCount++;
    requestAnimationFrame(render);
  };

  render();
};
