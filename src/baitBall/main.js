import { chottoGL } from '../libs/esChottoGL.js';
import { Timer } from '../libs/Timer.js';
import { PointerInput } from '../libs/PointerInput.js';
import GUI from '../libs/lil-gui.esm.min.js';

import initFrag from '../libs/shaderLoader.js?path=./shaders/init.frag';
import updateFrag from '../libs/shaderLoader.js?path=./shaders/update.frag';
import particleVert from '../libs/shaderLoader.js?path=./shaders/particle.vert';
import particleFrag from '../libs/shaderLoader.js?path=./shaders/particle.frag';
import floorVert from '../libs/shaderLoader.js?path=./shaders/floor.vert';
import floorFrag from '../libs/shaderLoader.js?path=./shaders/floor.frag';
import shadowVert from '../libs/shaderLoader.js?path=./shaders/shadow.vert';
import shadowFrag from '../libs/shaderLoader.js?path=./shaders/shadow.frag';
import dustVert from '../libs/shaderLoader.js?path=./shaders/dust.vert';
import dustFrag from '../libs/shaderLoader.js?path=./shaders/dust.frag';

import particleDepthFrag from '../libs/shaderLoader.js?path=./shaders/particleDepth.frag';
import floorDepthFrag from '../libs/shaderLoader.js?path=./shaders/floorDepth.frag';
import dustDepthFrag from '../libs/shaderLoader.js?path=./shaders/dustDepth.frag';

import thresholdFrag from '../libs/shaderLoader.js?path=./shaders/threshold.frag';
import blurFrag from '../libs/shaderLoader.js?path=./shaders/blur.frag';
import godrayFrag from '../libs/shaderLoader.js?path=./shaders/godray.frag';
import causticsPlaneVert from '../libs/shaderLoader.js?path=./shaders/causticsPlane.vert';
import causticsPlaneFrag from '../libs/shaderLoader.js?path=./shaders/causticsPlane.frag';

const INSTANCE_TEX_SIZE = 32;
const INSTANCE_COUNT = INSTANCE_TEX_SIZE * INSTANCE_TEX_SIZE;

const PASSTHROUGH_FRAG = `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 fragColor;
uniform sampler2D uTexture;
void main() { fragColor = texture(uTexture, vTexCoord); }`;

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const chotto = chottoGL(canvas, {
    extensions: ['EXT_color_buffer_float'],
  });
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const gl = chotto.gl;
  gl.viewport(0, 0, canvas.width, canvas.height);
  const timer = new Timer();
  timer.start();

  // --- Pointer Input ---
  const pointer = new PointerInput(canvas);
  let mouseWorld = [0, 0, 0];
  let mouseActive = false;

  // --- Parameters ---
  const params = {
    // Flow field motion
    ringRadius: 1.1225,
    ringThickness: 0.6454,
    ringPull: 1.708,
    swirlSpeed: 0.5,
    swirlWobble: 0.35,
    wobbleSpeed: 0.1,
    curlLargeAmount: 0.3,
    curlLargeScale: 0.45,
    curlSmallAmount: 0.15,
    curlSmallScale: 1.3,
    scatter: 0.5,
    noiseSpeed: 0.12,
    // Lifetime
    lifetime: 8.815,
    // Visual
    fishLength: 0.09048,
    fishWidth: 0.025,
    fishHeight: 0.02508,
    sizeVariation: 0.4848,
    // Camera
    rotationX: -0.2,
    zoom: 1.0,
    // Lighting
    lightColor: '#ffffff',
    ambient: 0.4,
    ambientColor: '#2a4a6a',
    // Colors
    baseColor: '#4488cc',
    accentColor: '#88ccff',
    colorMix: 0.3,
    bgColor: '#0a1520',
    // Floor
    floorY: -1.1,
    floorColor: '#3a5070',
    floorFade: 2.82,
    // Caustics
    causticsScale: 3.3565,
    causticsSpeed: 0.936,
    causticsIntensity: 0.4,
    causticsRadius: 2.0,
    causticsCenterX: 0.252,
    causticsCenterZ: -0.054,
    causticsAberration: 0.0262,
    causticsColor: '#aad1ee',
    debugCaustics: false,
    // Bloom
    bloomThreshold: 0.25,
    bloomStrength: 0.8325,
    bloomIterations: 5,
    // Dust (bubbles)
    dustCount: 500,
    dustSize: 1.3715,
    dustSpread: 2.964,
    dustSpeed: 0.16205,
    dustColor: '#748faa',
    // Fog
    fogStrength: 0.835,
    fogColor: '#0a2030',
    // God rays
    godrayStrength: 0.5854,
    godraySpeed: 0.5,
    godrayScale: 1.5,
    godrayFalloff: 1.2,
    godrayColor: '#4488aa',
    // Interaction
    avoidRadius: 0.8,
    avoidStrength: 2.0,
    // Seed
    seed: 5744,
    // Actions
    reset: () => initGPGPU(),
    randomize: () => {
      params.seed = Math.floor(Math.random() * 10000);
      initGPGPU();
    },
    exportParams: () => {
      const exported = {};
      for (const key in params) {
        if (typeof params[key] !== 'function') {
          exported[key] = params[key];
        }
      }
      console.log('// Current parameters:');
      console.log(JSON.stringify(exported, null, 2));
      navigator.clipboard?.writeText(JSON.stringify(exported, null, 2));
      alert('Parameters copied to clipboard! (also logged to console)');
    },
  };

  // --- Shaders ---
  const initShader = chotto.createShader({ fragment: initFrag });
  const updateShader = chotto.createShader({ fragment: updateFrag });
  const particleShader = chotto.createShader({ vertex: particleVert, fragment: particleFrag });
  const floorShader = chotto.createShader({ vertex: floorVert, fragment: floorFrag });
  const shadowShader = chotto.createShader({ vertex: shadowVert, fragment: shadowFrag });
  const dustShader = chotto.createShader({ vertex: dustVert, fragment: dustFrag });
  const particleDepthShader = chotto.createShader({ vertex: particleVert, fragment: particleDepthFrag });
  const floorDepthShader = chotto.createShader({ vertex: floorVert, fragment: floorDepthFrag });
  const dustDepthShader = chotto.createShader({ vertex: dustVert, fragment: dustDepthFrag });
  const passthroughShader = chotto.createShader({ fragment: PASSTHROUGH_FRAG });
  const thresholdShader = chotto.createShader({ fragment: thresholdFrag });
  const blurShader = chotto.createShader({ fragment: blurFrag });
  const godrayShader = chotto.createShader({ fragment: godrayFrag });
  const causticsPlaneShader = chotto.createShader({ vertex: causticsPlaneVert, fragment: causticsPlaneFrag });

  // Debug caustics shader
  const debugCausticsShader = chotto.createShader({
    fragment: `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 fragColor;
uniform float iTime;
uniform float iCausticsScale;
uniform float iCausticsSpeed;

vec2 rotate2D(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Based on neuro-noise by zozuar
// https://x.com/zozuar/status/1625182758745128981/
float neuroNoise(vec2 uv, float t) {
    vec2 sineAcc = vec2(0.0);
    vec2 res = vec2(0.0);
    float scale = 8.0;

    for (int j = 0; j < 15; j++) {
        uv = rotate2D(uv, 1.0);
        sineAcc = rotate2D(sineAcc, 1.0);
        vec2 layer = uv * scale + float(j) + sineAcc - t;
        sineAcc += sin(layer);
        res += (0.5 + 0.5 * cos(layer)) / scale;
        scale *= 1.2;
    }
    return res.x + res.y;
}

float causticsPattern(vec2 uv, float t) {
    float noise = neuroNoise(uv, t);
    // Shape the noise for caustics look
    noise = noise * noise;
    noise = pow(noise, 0.8);
    return min(1.0, noise);
}

vec3 caustics(vec2 uv, float t, float scale) {
    float aberration = 0.02;
    vec2 scaledUV = uv * scale;

    float r = causticsPattern(scaledUV + vec2(aberration, 0.0), t);
    float g = causticsPattern(scaledUV, t);
    float b = causticsPattern(scaledUV - vec2(aberration, 0.0), t);

    return vec3(r, g, b);
}

void main() {
    vec2 uv = vTexCoord * 4.0 - 2.0;
    float t = iTime * iCausticsSpeed;
    vec3 c = caustics(uv, t, iCausticsScale);
    fragColor = vec4(c, 1.0);
}
`
  });

  // --- Float texture options ---
  const floatTexOpts = {
    internalFormat: gl.RGBA32F,
    format: gl.RGBA,
    type: gl.FLOAT,
    minFilter: gl.NEAREST,
    magFilter: gl.NEAREST,
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE,
  };

  // --- GPGPU FBOs ---
  let position0 = chotto.createFramebuffer(INSTANCE_TEX_SIZE, INSTANCE_TEX_SIZE, null, floatTexOpts);
  let position1 = chotto.createFramebuffer(INSTANCE_TEX_SIZE, INSTANCE_TEX_SIZE, null, floatTexOpts);

  // --- Rendering FBOs ---
  let renderFBO = chotto.createFramebuffer(canvas.width, canvas.height);
  let depthFBO = chotto.createFramebuffer(canvas.width, canvas.height);
  let blurPing = chotto.createFramebuffer(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
  let blurPong = chotto.createFramebuffer(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
  let brightFBO = chotto.createFramebuffer(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));

  // --- Geometry: Fish mesh ---
  const createFishMesh = () => {
    const positions = [];
    const normals = [];

    // Fish body: tapered ellipsoid along X-axis
    // Head at +X, tail at -X
    const bodySegments = 8;
    const radialSegments = 6;

    // Body profile: x position -> (width, height) radius
    const bodyProfile = [
      { x: 0.5, ry: 0.15, rz: 0.1 },   // nose (pointed)
      { x: 0.35, ry: 0.4, rz: 0.35 },  // front
      { x: 0.1, ry: 0.5, rz: 0.5 },    // widest part
      { x: -0.15, ry: 0.45, rz: 0.45 },// back body
      { x: -0.35, ry: 0.25, rz: 0.2 }, // tail base
      { x: -0.5, ry: 0.05, rz: 0.02 }, // tail connection
    ];

    // Generate body vertices ring by ring
    const rings = [];
    for (let i = 0; i < bodyProfile.length; i++) {
      const p = bodyProfile[i];
      const ring = [];
      for (let j = 0; j < radialSegments; j++) {
        const angle = (j / radialSegments) * Math.PI * 2;
        const y = Math.cos(angle) * p.ry;
        const z = Math.sin(angle) * p.rz;
        ring.push({ x: p.x, y, z });
      }
      rings.push(ring);
    }

    // Connect rings with triangles
    for (let i = 0; i < rings.length - 1; i++) {
      const ring1 = rings[i];
      const ring2 = rings[i + 1];
      for (let j = 0; j < radialSegments; j++) {
        const j2 = (j + 1) % radialSegments;
        const v1 = ring1[j];
        const v2 = ring1[j2];
        const v3 = ring2[j];
        const v4 = ring2[j2];

        // Triangle 1
        positions.push(v1.x, v1.y, v1.z);
        positions.push(v3.x, v3.y, v3.z);
        positions.push(v2.x, v2.y, v2.z);

        // Triangle 2
        positions.push(v2.x, v2.y, v2.z);
        positions.push(v3.x, v3.y, v3.z);
        positions.push(v4.x, v4.y, v4.z);
      }
    }

    // Tail fin (V-shape, extends backward)
    const tailBase = { x: -0.5, y: 0, z: 0 };
    const tailTop = { x: -0.8, y: 0.3, z: 0 };
    const tailBottom = { x: -0.8, y: -0.3, z: 0 };
    const tailMid = { x: -0.65, y: 0, z: 0 };

    // Upper tail triangle (both sides for visibility)
    positions.push(tailBase.x, tailBase.y, tailBase.z);
    positions.push(tailMid.x, tailMid.y, tailMid.z);
    positions.push(tailTop.x, tailTop.y, tailTop.z);

    positions.push(tailBase.x, tailBase.y, tailBase.z);
    positions.push(tailTop.x, tailTop.y, tailTop.z);
    positions.push(tailMid.x, tailMid.y, tailMid.z);

    // Lower tail triangle (both sides)
    positions.push(tailBase.x, tailBase.y, tailBase.z);
    positions.push(tailBottom.x, tailBottom.y, tailBottom.z);
    positions.push(tailMid.x, tailMid.y, tailMid.z);

    positions.push(tailBase.x, tailBase.y, tailBase.z);
    positions.push(tailMid.x, tailMid.y, tailMid.z);
    positions.push(tailBottom.x, tailBottom.y, tailBottom.z);

    // Dorsal fin (top fin)
    const dorsalBase1 = { x: 0.1, y: 0.25, z: 0 };
    const dorsalBase2 = { x: -0.2, y: 0.22, z: 0 };
    const dorsalTip = { x: -0.05, y: 0.45, z: 0 };

    positions.push(dorsalBase1.x, dorsalBase1.y, dorsalBase1.z);
    positions.push(dorsalTip.x, dorsalTip.y, dorsalTip.z);
    positions.push(dorsalBase2.x, dorsalBase2.y, dorsalBase2.z);

    positions.push(dorsalBase1.x, dorsalBase1.y, dorsalBase1.z);
    positions.push(dorsalBase2.x, dorsalBase2.y, dorsalBase2.z);
    positions.push(dorsalTip.x, dorsalTip.y, dorsalTip.z);

    // Calculate normals for each triangle
    const posArray = new Float32Array(positions);
    const numTriangles = positions.length / 9;

    for (let i = 0; i < numTriangles; i++) {
      const idx = i * 9;
      const v0 = [posArray[idx], posArray[idx + 1], posArray[idx + 2]];
      const v1 = [posArray[idx + 3], posArray[idx + 4], posArray[idx + 5]];
      const v2 = [posArray[idx + 6], posArray[idx + 7], posArray[idx + 8]];

      const edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
      const edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

      const nx = edge1[1] * edge2[2] - edge1[2] * edge2[1];
      const ny = edge1[2] * edge2[0] - edge1[0] * edge2[2];
      const nz = edge1[0] * edge2[1] - edge1[1] * edge2[0];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

      for (let j = 0; j < 3; j++) {
        normals.push(nx / len, ny / len, nz / len);
      }
    }

    return createVAO(new Float32Array(positions), new Float32Array(normals), positions.length / 3);
  };

  const createVAO = (positions, normals, vertexCount) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, vertexCount };
  };

  const fishMesh = createFishMesh();

  // --- Floor geometry ---
  const createFloorMesh = () => {
    const size = 5.0;
    const positions = new Float32Array([
      -size, 0, -size,
       size, 0, -size,
       size, 0,  size,
      -size, 0, -size,
       size, 0,  size,
      -size, 0,  size,
    ]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, vertexCount: 6 };
  };
  const floorMesh = createFloorMesh();

  // --- Caustics plane geometry (with UVs) ---
  const createCausticsPlane = () => {
    // Position (x, y, z) + UV (u, v)
    const data = new Float32Array([
      // positions          // uvs
      -1, 0, -1,            0, 0,
       1, 0, -1,            1, 0,
       1, 0,  1,            1, 1,
      -1, 0, -1,            0, 0,
       1, 0,  1,            1, 1,
      -1, 0,  1,            0, 1,
    ]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    // Position attribute
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 5 * 4, 0);
    // UV attribute
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.bindVertexArray(null);
    return { vao, vertexCount: 6 };
  };
  const causticsPlane = createCausticsPlane();

  const hexToRGB = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

  // --- Initialize GPGPU ---
  const initGPGPU = () => {
    position0.pass(initShader, {
      uTexSize: [INSTANCE_TEX_SIZE, INSTANCE_TEX_SIZE],
      uSeed: params.seed,
      uRingRadius: params.ringRadius,
      uRingThickness: params.ringThickness,
    });
    position1.pass(passthroughShader, { uTexture: position0 });
  };
  initGPGPU();

  // --- GUI ---
  const gui = new GUI({ title: 'Bait Ball' });

  const flowFolder = gui.addFolder('Flow Field');
  flowFolder.add(params, 'swirlSpeed', 0.0, 1.5).name('Swirl Speed');
  flowFolder.add(params, 'swirlWobble', 0.0, 1.0).name('Swirl Wobble');
  flowFolder.add(params, 'wobbleSpeed', 0.01, 0.5).name('Wobble Speed');
  flowFolder.add(params, 'curlLargeAmount', 0.0, 1.0).name('Curl Large');
  flowFolder.add(params, 'curlLargeScale', 0.1, 1.5).name('Curl Large Scale');
  flowFolder.add(params, 'curlSmallAmount', 0.0, 0.6).name('Curl Small');
  flowFolder.add(params, 'curlSmallScale', 0.5, 3.0).name('Curl Small Scale');
  flowFolder.add(params, 'scatter', 0.0, 1.0).name('Scatter');
  flowFolder.add(params, 'noiseSpeed', 0.02, 0.5).name('Noise Evolve');

  const shapeFolder = gui.addFolder('Shape');
  shapeFolder.add(params, 'ringRadius', 0.5, 2.0).name('Ring Radius').onChange(() => initGPGPU());
  shapeFolder.add(params, 'ringThickness', 0.1, 1.0).name('Ring Thickness');
  shapeFolder.add(params, 'ringPull', 0.0, 4.0).name('Ring Pull');

  const simFolder = gui.addFolder('Simulation');
  simFolder.add(params, 'lifetime', 5.0, 40.0).name('Lifetime (sec)');

  const visualFolder = gui.addFolder('Visual');
  visualFolder.add(params, 'fishLength', 0.03, 0.15).name('Fish Length');
  visualFolder.add(params, 'fishWidth', 0.01, 0.06).name('Fish Width');
  visualFolder.add(params, 'fishHeight', 0.01, 0.05).name('Fish Height');
  visualFolder.add(params, 'sizeVariation', 0.0, 0.8).name('Size Variation');

  const cameraFolder = gui.addFolder('Camera');
  cameraFolder.add(params, 'rotationX', -1.57, 1.57).name('Rotation X');
  cameraFolder.add(params, 'zoom', 0.5, 2.0).name('Zoom');

  const lightFolder = gui.addFolder('Lighting');
  lightFolder.addColor(params, 'lightColor').name('Light Color');
  lightFolder.add(params, 'ambient', 0.0, 1.0).name('Ambient');
  lightFolder.addColor(params, 'ambientColor').name('Ambient Color');

  const colorFolder = gui.addFolder('Colors');
  colorFolder.addColor(params, 'baseColor').name('Base Color');
  colorFolder.addColor(params, 'accentColor').name('Accent Color');
  colorFolder.add(params, 'colorMix', 0.0, 1.0).name('Color Mix');
  colorFolder.addColor(params, 'bgColor').name('Background');

  const floorFolder = gui.addFolder('Floor');
  floorFolder.add(params, 'floorY', -2.5, 0.0).name('Floor Height');
  floorFolder.addColor(params, 'floorColor').name('Floor Color');
  floorFolder.add(params, 'floorFade', 1.0, 6.0).name('Floor Fade');

  const causticsFolder = gui.addFolder('Caustics');
  causticsFolder.add(params, 'causticsScale', 0.1, 4.0).name('Scale');
  causticsFolder.add(params, 'causticsSpeed', 0.1, 2.0).name('Speed');
  causticsFolder.add(params, 'causticsIntensity', 0.0, 1.0).name('Intensity');
  causticsFolder.add(params, 'causticsRadius', 0.5, 5.0).name('Radius');
  causticsFolder.add(params, 'causticsCenterX', -3.0, 3.0).name('Center X');
  causticsFolder.add(params, 'causticsCenterZ', -3.0, 3.0).name('Center Z');
  causticsFolder.add(params, 'causticsAberration', 0.0, 0.1).name('Aberration');
  causticsFolder.addColor(params, 'causticsColor').name('Color');
  causticsFolder.add(params, 'debugCaustics').name('Debug Preview');

  const bloomFolder = gui.addFolder('Bloom');
  bloomFolder.add(params, 'bloomThreshold', 0.0, 1.0).name('Threshold');
  bloomFolder.add(params, 'bloomStrength', 0.0, 1.5).name('Strength');
  bloomFolder.add(params, 'bloomIterations', 1, 8).step(1).name('Iterations');

  const godrayFolder = gui.addFolder('God Rays');
  godrayFolder.add(params, 'godrayStrength', 0.0, 1.5).name('Strength');
  godrayFolder.add(params, 'godraySpeed', 0.01, 1.0).name('Speed');
  godrayFolder.add(params, 'godrayScale', 1.0, 5.0).name('Scale');
  godrayFolder.add(params, 'godrayFalloff', 0.5, 3.0).name('Falloff');
  godrayFolder.addColor(params, 'godrayColor').name('Color');

  const dustFolder = gui.addFolder('Bubbles');
  dustFolder.add(params, 'dustCount', 100, 2000).step(100).name('Count');
  dustFolder.add(params, 'dustSize', 0.5, 4.0).name('Size');
  dustFolder.add(params, 'dustSpread', 1.0, 5.0).name('Spread');
  dustFolder.add(params, 'dustSpeed', 0.05, 0.5).name('Speed');
  dustFolder.addColor(params, 'dustColor').name('Color');

  const fogFolder = gui.addFolder('Fog');
  fogFolder.add(params, 'fogStrength', 0.0, 1.0).name('Strength');
  fogFolder.addColor(params, 'fogColor').name('Color');

  const interactionFolder = gui.addFolder('Interaction');
  interactionFolder.add(params, 'avoidRadius', 0.2, 2.0).name('Avoid Radius');
  interactionFolder.add(params, 'avoidStrength', 0.5, 5.0).name('Avoid Strength');

  gui.add(params, 'seed', 0, 9999).step(1).name('Seed').onChange(() => initGPGPU());
  gui.add(params, 'reset').name('Reset');
  gui.add(params, 'randomize').name('Randomize');
  gui.add(params, 'exportParams').name('📋 Export Params');
  gui.close();
  gui.hide();

  // --- Resize ---
  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    renderFBO.resize(w, h);
    depthFBO.resize(w, h);
    const bw = Math.floor(w / 2);
    const bh = Math.floor(h / 2);
    brightFBO.resize(bw, bh);
    blurPing.resize(bw, bh);
    blurPong.resize(bw, bh);
  };
  window.addEventListener('resize', onResize);

  // --- Render loop ---
  const render = () => {
    const time = timer.getElapsedTime();

    // === Update mouse world position ===
    mouseActive = pointer.isInside() || pointer.isPressed();
    if (mouseActive) {
      const pos = pointer.getNormalizedPosition();
      const aspect = canvas.width / canvas.height;
      const cosX = Math.cos(params.rotationX);
      const sinX = Math.sin(params.rotationX);
      const range = 2.5 / params.zoom;
      const mx = pos.x * range * aspect;
      const my = pos.y * range;
      mouseWorld = [mx, my * sinX, -my * cosX];
    }

    // === GPGPU: Update position ===
    position1.pass(updateShader, {
      uPosition: position0,
      uTexSize: [INSTANCE_TEX_SIZE, INSTANCE_TEX_SIZE],
      iTime: time,
      iLifetime: params.lifetime,
      iRingRadius: params.ringRadius,
      iRingThickness: params.ringThickness,
      iRingPull: params.ringPull,
      iSwirlSpeed: params.swirlSpeed,
      iSwirlWobble: params.swirlWobble,
      iWobbleSpeed: params.wobbleSpeed,
      iCurlLargeAmount: params.curlLargeAmount,
      iCurlLargeScale: params.curlLargeScale,
      iCurlSmallAmount: params.curlSmallAmount,
      iCurlSmallScale: params.curlSmallScale,
      iScatter: params.scatter,
      iNoiseSpeed: params.noiseSpeed,
      iMousePos: mouseWorld,
      iMouseActive: mouseActive ? 1.0 : 0.0,
      iAvoidRadius: params.avoidRadius,
      iAvoidStrength: params.avoidStrength,
    });
    [position0, position1] = [position1, position0];

    // === Render scene ===
    const bgColor = hexToRGB(params.bgColor);
    renderFBO.pass(() => {
      gl.clearColor(bgColor[0], bgColor[1], bgColor[2], 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);

      // --- Floor ---
      floorShader.use()
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0])
        .setUniform('iFloorY', params.floorY)
        .setUniform('iBgColor', bgColor)
        .setUniform('iFloorColor', hexToRGB(params.floorColor))
        .setUniform('iFloorFade', params.floorFade);

      gl.bindVertexArray(floorMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, floorMesh.vertexCount);
      gl.bindVertexArray(null);

      // --- Caustics plane ---
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // Additive blending

      causticsPlaneShader.use()
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0])
        .setUniform('iFloorY', params.floorY)
        .setUniform('iCausticsRadius', params.causticsRadius)
        .setUniform('iCausticsCenter', [params.causticsCenterX, params.causticsCenterZ])
        .setUniform('iTime', time)
        .setUniform('iCausticsScale', params.causticsScale)
        .setUniform('iCausticsSpeed', params.causticsSpeed)
        .setUniform('iCausticsIntensity', params.causticsIntensity)
        .setUniform('iCausticsAberration', params.causticsAberration)
        .setUniform('iCausticsColor', hexToRGB(params.causticsColor));

      gl.bindVertexArray(causticsPlane.vao);
      gl.drawArrays(gl.TRIANGLES, 0, causticsPlane.vertexCount);
      gl.bindVertexArray(null);

      gl.disable(gl.BLEND);

      // --- Shadows (fish projected onto floor) ---
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      shadowShader.use()
        .setTexture('uPosition', position0.texture)
        .setTexture('uPrevPosition', position1.texture)
        .setUniform('uTexSize', [INSTANCE_TEX_SIZE, INSTANCE_TEX_SIZE])
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iTime', time)
        .setUniform('iParticleSize', params.fishLength)
        .setUniform('iRodThickness', params.fishWidth)
        .setUniform('iFishHeight', params.fishHeight)
        .setUniform('iSizeVariation', params.sizeVariation)
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0])
        .setUniform('iFloorY', params.floorY)
        .setUniform('iLightDir', [0.0, 1.0, 0.3])
        .setUniform('iFloorColor', hexToRGB(params.floorColor));

      gl.bindVertexArray(fishMesh.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, fishMesh.vertexCount, INSTANCE_COUNT);
      gl.bindVertexArray(null);

      gl.disable(gl.BLEND);

      // --- Fish ---
      particleShader.use()
        .setTexture('uPosition', position0.texture)
        .setTexture('uPrevPosition', position1.texture)
        .setUniform('uTexSize', [INSTANCE_TEX_SIZE, INSTANCE_TEX_SIZE])
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iTime', time)
        .setUniform('iParticleSize', params.fishLength)
        .setUniform('iRodThickness', params.fishWidth)
        .setUniform('iFishHeight', params.fishHeight)
        .setUniform('iSizeVariation', params.sizeVariation)
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0])
        .setUniform('iLightDir', [0.0, 1.0, 0.3])
        .setUniform('iLightColor', hexToRGB(params.lightColor))
        .setUniform('iAmbient', params.ambient)
        .setUniform('iAmbientColor', hexToRGB(params.ambientColor))
        .setUniform('iBaseColor', hexToRGB(params.baseColor))
        .setUniform('iAccentColor', hexToRGB(params.accentColor))
        .setUniform('iColorMix', params.colorMix);

      gl.bindVertexArray(fishMesh.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, fishMesh.vertexCount, INSTANCE_COUNT);
      gl.bindVertexArray(null);

      // --- Bubbles ---
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);

      dustShader.use()
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iTime', time)
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0])
        .setUniform('iDustSize', params.dustSize)
        .setUniform('iDustSpread', params.dustSpread)
        .setUniform('iDustSpeed', params.dustSpeed)
        .setUniform('iDustColor', hexToRGB(params.dustColor));

      gl.drawArrays(gl.POINTS, 0, params.dustCount);

      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
    });

    // === Depth pass ===
    depthFBO.pass(() => {
      gl.clearColor(1.0, 1.0, 1.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);

      // Floor depth
      floorDepthShader.use()
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0])
        .setUniform('iFloorY', params.floorY);

      gl.bindVertexArray(floorMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, floorMesh.vertexCount);
      gl.bindVertexArray(null);

      // Fish depth
      particleDepthShader.use()
        .setTexture('uPosition', position0.texture)
        .setTexture('uPrevPosition', position1.texture)
        .setUniform('uTexSize', [INSTANCE_TEX_SIZE, INSTANCE_TEX_SIZE])
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iTime', time)
        .setUniform('iParticleSize', params.fishLength)
        .setUniform('iRodThickness', params.fishWidth)
        .setUniform('iFishHeight', params.fishHeight)
        .setUniform('iSizeVariation', params.sizeVariation)
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0]);

      gl.bindVertexArray(fishMesh.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, fishMesh.vertexCount, INSTANCE_COUNT);
      gl.bindVertexArray(null);

      // Bubble depth
      dustDepthShader.use()
        .setUniform('uResolution', [canvas.width, canvas.height])
        .setUniform('iTime', time)
        .setUniform('iZoom', params.zoom)
        .setUniform('iRotation', [params.rotationX, 0.0])
        .setUniform('iDustSize', params.dustSize)
        .setUniform('iDustSpread', params.dustSpread)
        .setUniform('iDustSpeed', params.dustSpeed);

      gl.drawArrays(gl.POINTS, 0, params.dustCount);

      gl.disable(gl.DEPTH_TEST);
    });

    // === Bloom ===
    const bw = Math.floor(canvas.width / 2);
    const bh = Math.floor(canvas.height / 2);
    const texelSize = [1.0 / bw, 1.0 / bh];

    brightFBO.pass(thresholdShader, { uTexture: renderFBO, iThreshold: params.bloomThreshold });

    let readFBO = brightFBO;
    for (let i = 0; i < params.bloomIterations; i++) {
      const writeFBO = (i % 2 === 0) ? blurPing : blurPong;
      writeFBO.pass(blurShader, { uTexture: readFBO, uTexelSize: texelSize, uIteration: i });
      readFBO = writeFBO;
    }

    // === Final output with god rays and fog ===
    chotto.pass(godrayShader, {
      uTexture: renderFBO,
      uBloom: readFBO,
      uDepth: depthFBO,
      iTime: time,
      iBloomStrength: params.bloomStrength,
      iGodrayStrength: params.godrayStrength,
      iGodraySpeed: params.godraySpeed,
      iGodrayScale: params.godrayScale,
      iGodrayFalloff: params.godrayFalloff,
      iGodrayColor: hexToRGB(params.godrayColor),
      iFogStrength: params.fogStrength,
      iFogColor: hexToRGB(params.fogColor),
    });

    // === Debug: Caustics preview (bottom-left 300x300) ===
    if (params.debugCaustics) {
      const debugSize = 300;
      gl.viewport(10, 10, debugSize, debugSize);
      gl.scissor(10, 10, debugSize, debugSize);
      gl.enable(gl.SCISSOR_TEST);

      chotto.pass(debugCausticsShader, {
        iTime: time,
        iCausticsScale: params.causticsScale,
        iCausticsSpeed: params.causticsSpeed,
      });

      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    requestAnimationFrame(render);
  };

  render();
};
