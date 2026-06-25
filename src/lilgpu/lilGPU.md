# lilGPU — Minimal WebGPU Framework

A thin wrapper over WebGPU that eliminates boilerplate while keeping you in full control.
No magic parsing, no hidden allocations — just device init, pipeline helpers, framebuffer management, and command batching.

## What it does

- Initializes adapter, device, and canvas context
- Creates render/compute pipelines with sensible defaults
- Manages framebuffers with MRT, MSAA, and depth support
- Creates GPU buffers with read/write helpers
- Batches commands per frame via `frame()`
- Handles canvas resize with `fitWindow()`
- Tracks resources for bulk disposal

## What it does NOT do

- Parse WGSL or auto-generate bind groups — you create them via `device.createBindGroup()`
- Manage an animation loop — you call `requestAnimationFrame` yourself
- Load textures or models — use plugins/helpers for that
- Fall back to WebGL — WebGPU only

---

## Quick Start

```js
import { lilGPU } from '../lilgpu/lilGPU.js';

const canvas = document.querySelector('canvas');
const gpu = await lilGPU(canvas);
gpu.fitWindow();

const pipeline = gpu.pipeline({
  vertex: gpu.FULLSCREEN_VERT,
  fragment: myFragmentWGSL,
});

// Create a uniform buffer matching your WGSL struct layout
// Tip: put vec2f/vec3f/vec4f fields first to avoid alignment padding
const uniforms = gpu.buffer(new Float32Array(4), { uniform: true });

const bindGroup = gpu.device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniforms.buffer } }],
});

function render() {
  uniforms.write(new Float32Array([canvas.width, canvas.height, performance.now() * 0.001, 0]));
  gpu.pass((p) => {
    p.setPipeline(pipeline);
    p.setBindGroup(0, bindGroup);
    p.draw(3);
  });
  requestAnimationFrame(render);
}
render();
```

---

## API Reference

### `lilGPU(canvas, options?) → Promise<GPU>`

Initialize the framework. Throws if WebGPU is not available.

**Options:**
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `powerPreference` | string | `'high-performance'` | GPU power preference |
| `requiredFeatures` | string[] | `[]` | Required device features |
| `requiredLimits` | object | `{}` | Required device limits |
| `onError` | function | `console.error` | Handler for uncaptured WebGPU errors |

**Returned object properties:**
| Property | Type | Description |
|----------|------|-------------|
| `device` | GPUDevice | The WebGPU device |
| `context` | GPUCanvasContext | Canvas context |
| `format` | string | Preferred canvas texture format (e.g. `'bgra8unorm'`) |
| `adapter` | GPUAdapter | The GPU adapter |
| `sampler` | GPUSampler | Default sampler: linear filtering, clamp-to-edge |
| `FULLSCREEN_VERT` | string | WGSL vertex shader for a fullscreen triangle. Outputs `@location(0) uv: vec2f` |

---

### `gpu.pipeline(opts) → GPURenderPipeline`

Create a render pipeline. Returns the **raw** `GPURenderPipeline` — no wrapper.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `vertex` | string | `FULLSCREEN_VERT` | WGSL vertex shader source |
| `fragment` | string | **required** | WGSL fragment shader source |
| `vertexEntry` | string | `'vs'` | Vertex entry point |
| `fragmentEntry` | string | `'fs'` | Fragment entry point |
| `format` | string \| string[] | canvas format | Target format(s). Array for MRT. |
| `blend` | GPUBlendState | — | Blend state applied to all targets |
| `topology` | string | `'triangle-list'` | Primitive topology |
| `cullMode` | string | `'none'` | Face culling mode |
| `vertexBuffers` | array | `[]` | `GPUVertexBufferLayout[]` |
| `samples` | number | 1 | MSAA sample count |
| `depthTest` | boolean | `false` | Enable depth testing |
| `depthFormat` | string | `'depth24plus'` | Depth texture format (when depthTest is true) |
| `depthWrite` | boolean | `true` | Write to depth buffer |
| `depthCompare` | string | `'less'` | Depth comparison function |

---

### `gpu.compute(opts) → GPUComputePipeline`

Create a compute pipeline. Returns the **raw** `GPUComputePipeline`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `shader` | string | **required** | WGSL compute shader source |
| `entryPoint` | string | `'main'` | Compute entry point |

---

### `gpu.framebuffer(width, height, opts?) → Framebuffer`

Create an off-screen render target. Supports MRT and MSAA.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | string | canvas format | Single color attachment format (shorthand) |
| `colorFormats` | string[] | — | MRT: array of formats. Overrides `format`. |
| `depth` | boolean | `false` | Create a depth attachment |
| `depthFormat` | string | `'depth24plus'` | Depth format (when depth is true) |
| `samples` | number | 1 | MSAA sample count |
| `storage` | boolean | `false` | Add `STORAGE_BINDING` usage to color textures |

**Returned object:**
| Property | Type | Description |
|----------|------|-------------|
| `width` / `height` | number | Current dimensions |
| `texture` | GPUTexture | Alias for `textures[0]` |
| `view` | GPUTextureView | Alias for `views[0]` |
| `textures` | GPUTexture[] | One per color attachment |
| `views` | GPUTextureView[] | One per color attachment |
| `depthTexture` | GPUTexture \| null | Depth texture (if depth enabled) |
| `depthView` | GPUTextureView \| null | Depth view (if depth enabled) |
| `samples` | number | MSAA sample count |
| `resize(w, h)` | method | Recreate textures at new size. Returns `this`. |
| `dispose()` | method | Destroy all textures. |

**MSAA behavior:** When `samples > 1`, internal multisample textures are created for rendering. The `views[]` (single-sample) receive the resolved result automatically via `pass()`.

---

### `gpu.buffer(dataOrSize, opts?) → Buffer`

Create a GPU buffer.

**First argument:** `TypedArray` (creates + uploads) or `number` (byte size, uninitialized).

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage` | boolean | — | `STORAGE` usage |
| `uniform` | boolean | — | `UNIFORM` usage |
| `vertex` | boolean | — | `VERTEX` usage |
| `index` | boolean | — | `INDEX` usage |
| `usage` | number | — | Additional `GPUBufferUsage` flags |

If no usage flag is set, defaults to `STORAGE`.

**Returned object:**
| Property | Type | Description |
|----------|------|-------------|
| `buffer` | GPUBuffer | The raw GPU buffer |
| `size` | number | Buffer size in bytes |
| `write(data, offset?)` | method | Write typed array to buffer. Returns `this`. |
| `read(outputArray)` | async method | Read buffer contents into a typed array. Returns the array. |
| `dispose()` | method | Destroy the buffer. |

---

### `gpu.pass(opts?, fn) → gpu`

Execute a render pass. The callback receives a raw `GPURenderPassEncoder`.

**Signatures:**
```js
gpu.pass(fn)                    // render to canvas, default clear black
gpu.pass({ target, clear }, fn) // render to framebuffer
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `target` | Framebuffer | — | Render target. Omit to render to canvas. |
| `clear` | [r,g,b,a] \| {r,g,b,a} \| false | `[0,0,0,1]` | Clear color. `false` = load previous contents. |

- MRT: all color attachments are included automatically.
- MSAA: multisample views are used as render targets; resolve happens automatically.
- Depth: if the target has a depth attachment, it is included automatically.

---

### `gpu.dispatch(fn) → gpu`

Execute a compute pass. The callback receives a raw `GPUComputePassEncoder`.

```js
gpu.dispatch((p) => {
  p.setPipeline(computePipeline);
  p.setBindGroup(0, bindGroup);
  p.dispatchWorkgroups(64, 1, 1);
});
```

---

### `gpu.frame(fn) → gpu`

Batch all `pass()` and `dispatch()` calls inside the callback into a single command encoder, submitted once at the end. This is the recommended way to render a frame.

```js
gpu.frame((gpu) => {
  gpu.dispatch(...);
  gpu.pass({ target: sceneFBO }, ...);
  gpu.pass(...);
});
```

Without `frame()`, each `pass()` / `dispatch()` submits its own command encoder immediately.

---

### `gpu.fitWindow(callback?) → gpu`

Resize canvas to fill the window (accounting for `devicePixelRatio`, capped at 2). Listens for `resize` events.

```js
gpu.fitWindow((width, height) => {
  sceneFBO.resize(width, height);
});
```

---

### `gpu.dispose()`

Destroy all tracked framebuffers and buffers, remove event listeners, and destroy the device.

---

## Patterns

### 1. Basic Fullscreen Fragment (Raymarching)

```js
const gpu = await lilGPU(canvas);
gpu.fitWindow();

const pipe = gpu.pipeline({
  vertex: gpu.FULLSCREEN_VERT,
  fragment: raymarchWGSL,
});

const ubo = gpu.buffer(new Float32Array(4), { uniform: true });

const bg = gpu.device.createBindGroup({
  layout: pipe.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: ubo.buffer } }],
});

(function render() {
  ubo.write(new Float32Array([performance.now() * 0.001, canvas.width, canvas.height, 0]));
  gpu.pass((p) => {
    p.setPipeline(pipe);
    p.setBindGroup(0, bg);
    p.draw(3);
  });
  requestAnimationFrame(render);
})();
```

### 2. Post-Effect Chain (Bloom)

```js
const scene = gpu.framebuffer(w, h, { format: 'rgba16float', depth: true });
const bright = gpu.framebuffer(w >> 1, h >> 1, { format: 'rgba16float' });
const pingFB = gpu.framebuffer(w >> 1, h >> 1, { format: 'rgba16float' });
const pongFB = gpu.framebuffer(w >> 1, h >> 1, { format: 'rgba16float' });

const threshPipe = gpu.pipeline({ vertex: gpu.FULLSCREEN_VERT, fragment: thresholdWGSL, format: 'rgba16float' });
const blurPipe = gpu.pipeline({ vertex: gpu.FULLSCREEN_VERT, fragment: blurWGSL, format: 'rgba16float' });
const composePipe = gpu.pipeline({ vertex: gpu.FULLSCREEN_VERT, fragment: composeWGSL });

// Helper to make a sampler+texture bind group
const makeBG = (pipe, group, textureView) => gpu.device.createBindGroup({
  layout: pipe.getBindGroupLayout(group),
  entries: [
    { binding: 0, resource: gpu.sampler },
    { binding: 1, resource: textureView },
  ],
});

gpu.frame((gpu) => {
  // Render scene
  gpu.pass({ target: scene, clear: [0, 0, 0, 1] }, (p) => { /* scene draw calls */ });

  // Threshold
  gpu.pass({ target: bright }, (p) => {
    p.setPipeline(threshPipe);
    p.setBindGroup(0, makeBG(threshPipe, 0, scene.view));
    p.draw(3);
  });

  // Blur ping-pong
  let read = bright;
  for (let i = 0; i < 5; i++) {
    const write = i % 2 === 0 ? pingFB : pongFB;
    gpu.pass({ target: write }, (p) => {
      p.setPipeline(blurPipe);
      p.setBindGroup(0, makeBG(blurPipe, 0, read.view));
      p.draw(3);
    });
    read = write;
  }

  // Compose to screen
  gpu.pass((p) => {
    p.setPipeline(composePipe);
    p.setBindGroup(0, gpu.device.createBindGroup({
      layout: composePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpu.sampler },
        { binding: 1, resource: scene.view },
        { binding: 2, resource: read.view },
      ],
    }));
    p.draw(3);
  });
});
```

### 3. G-Buffer / Deferred Rendering (MRT)

```js
const gbuffer = gpu.framebuffer(w, h, {
  colorFormats: ['rgba16float', 'rgba16float', 'rgba8unorm'], // albedo, normal, roughness
  depth: true,
  samples: 4,
});

const gbufPipe = gpu.pipeline({
  vertex: geometryVert,
  fragment: gbufferFrag,
  format: ['rgba16float', 'rgba16float', 'rgba8unorm'],
  depthTest: true,
  samples: 4,
  vertexBuffers: [vertexLayout],
});

const lightPipe = gpu.pipeline({
  vertex: gpu.FULLSCREEN_VERT,
  fragment: deferredLightWGSL,
});

gpu.frame((gpu) => {
  // Fill G-Buffer (writes to all 3 color attachments)
  gpu.pass({ target: gbuffer, clear: [0, 0, 0, 0] }, (p) => {
    p.setPipeline(gbufPipe);
    p.setBindGroup(0, sceneBindGroup);
    p.setVertexBuffer(0, meshBuffer);
    p.draw(vertexCount);
  });

  // Deferred lighting → screen
  gpu.pass((p) => {
    p.setPipeline(lightPipe);
    p.setBindGroup(0, gpu.device.createBindGroup({
      layout: lightPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpu.sampler },
        { binding: 1, resource: gbuffer.views[0] }, // albedo
        { binding: 2, resource: gbuffer.views[1] }, // normal
        { binding: 3, resource: gbuffer.views[2] }, // roughness
        { binding: 4, resource: { buffer: lightsUBO.buffer } },
      ],
    }));
    p.draw(3);
  });
});
```

### 4. Compute GPGPU (Particle Simulation)

```js
const COUNT = 256 * 256;
const WORKGROUP = 64;

const posA = gpu.buffer(new Float32Array(COUNT * 4));
const posB = gpu.buffer(new Float32Array(COUNT * 4));
const params = gpu.buffer(new Float32Array(8), { uniform: true });

const updatePipe = gpu.compute({ shader: updateWGSL });
const renderPipe = gpu.pipeline({
  vertex: particleVert, fragment: particleFrag,
  topology: 'triangle-strip', depthTest: true,
  format: 'rgba16float', samples: 4,
});

// Pre-create bind groups for ping-pong (A→B and B→A)
const computeBG_AB = gpu.device.createBindGroup({
  layout: updatePipe.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: posA.buffer } },
    { binding: 1, resource: { buffer: posB.buffer } },
    { binding: 2, resource: { buffer: params.buffer } },
  ],
});
const computeBG_BA = gpu.device.createBindGroup({
  layout: updatePipe.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: posB.buffer } },
    { binding: 1, resource: { buffer: posA.buffer } },
    { binding: 2, resource: { buffer: params.buffer } },
  ],
});

let flip = false;

gpu.frame((gpu) => {
  params.write(new Float32Array([time, dt, /*...*/]));

  gpu.dispatch((p) => {
    p.setPipeline(updatePipe);
    p.setBindGroup(0, flip ? computeBG_BA : computeBG_AB);
    p.dispatchWorkgroups(Math.ceil(COUNT / WORKGROUP));
  });
  flip = !flip;

  gpu.pass({ target: renderFBO, clear: [0, 0, 0, 1] }, (p) => {
    p.setPipeline(renderPipe);
    p.setBindGroup(0, particleDrawBG);
    p.draw(4, COUNT); // 4 verts per particle (triangle-strip), COUNT instances
  });
});
```

---

## Recipes

### Creating Bind Groups

Bind groups map your WGSL `@group/@binding` declarations to GPU resources.

```wgsl
// In your WGSL shader:
@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var myTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;
```

```js
const bg = gpu.device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0), // group index
  entries: [
    { binding: 0, resource: gpu.sampler },
    { binding: 1, resource: someFramebuffer.view },      // GPUTextureView
    { binding: 2, resource: { buffer: paramsUBO.buffer } }, // GPUBuffer
  ],
});
```

**Resources by type:**
| WGSL Declaration | Entry Resource |
|------------------|----------------|
| `var mySampler: sampler` | `gpu.sampler` or custom `GPUSampler` |
| `var myTex: texture_2d<f32>` | `framebuffer.view` or any `GPUTextureView` |
| `var<uniform> u: MyStruct` | `{ buffer: ubo.buffer }` |
| `var<storage, read> s: S` | `{ buffer: storageBuffer.buffer }` |
| `var<storage, read_write> s: S` | `{ buffer: storageBuffer.buffer }` |

### Ping-Pong Pattern

For iterative effects (blur, fluid simulation) or compute ping-pong:

```js
const fbA = gpu.framebuffer(w, h, { format: 'rgba16float' });
const fbB = gpu.framebuffer(w, h, { format: 'rgba16float' });

let read = fbA, write = fbB;

for (let i = 0; i < iterations; i++) {
  gpu.pass({ target: write }, (p) => {
    p.setPipeline(blurPipe);
    p.setBindGroup(0, makeBG(read.view));
    p.draw(3);
  });
  [read, write] = [write, read];
}
// Result is in `read`
```

### Handling Resize

When a framebuffer is resized, its textures and views are recreated. Any bind groups referencing the old views become invalid. Recreate them after resize.

```js
let sceneBG = makeBG(scene.view);

gpu.fitWindow((w, h) => {
  scene.resize(w, h);
  sceneBG = makeBG(scene.view); // recreate bind group with new view
});
```

Or recreate bind groups each frame (cheap for small numbers of bindings):

```js
gpu.frame((gpu) => {
  gpu.pass((p) => {
    p.setPipeline(pipe);
    p.setBindGroup(0, gpu.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpu.sampler },
        { binding: 1, resource: scene.view }, // always current
      ],
    }));
    p.draw(3);
  });
});
```

### Uniform Buffer Layout (WGSL Alignment)

WGSL uses specific alignment rules for struct fields. When writing a `Float32Array` to a uniform buffer, you must match the layout.

| WGSL Type | Size (bytes) | Alignment (bytes) | Float32 words |
|-----------|-------------|-------------------|---------------|
| `f32` | 4 | 4 | 1 |
| `i32` / `u32` | 4 | 4 | 1 |
| `vec2f` | 8 | 8 | 2 |
| `vec3f` | 12 | 16 | 3 (+1 pad) |
| `vec4f` | 16 | 16 | 4 |
| `mat4x4f` | 64 | 16 | 16 |

**Tip:** Place wider types first in your struct to minimize padding.

**Example (padding-free layout):**
```wgsl
struct Params {
  color: vec3f,      // offset 0 (aligned to 16), size 12
  intensity: f32,    // offset 12, size 4
  resolution: vec2f, // offset 16 (aligned to 8), size 8
  time: f32,         // offset 24, size 4
};
// Total: 32 bytes (aligned to 16)
```

```js
const data = new Float32Array(8); // 32 bytes
data[0] = r;           // offset 0: color.x
data[1] = g;           // offset 4: color.y
data[2] = b;           // offset 8: color.z
data[3] = intensity;   // offset 12: intensity
data[4] = width;       // offset 16: resolution.x
data[5] = height;      // offset 20: resolution.y
data[6] = time;        // offset 24: time
// data[7] is unused padding

ubo.write(data);
```

**Example (with padding):**
```wgsl
struct Params {
  time: f32,         // offset 0, size 4
  // 4 bytes padding (vec2f needs 8-byte alignment)
  resolution: vec2f, // offset 8, size 8
};
// Total: 16 bytes
```

```js
const data = new Float32Array(4); // 16 bytes
data[0] = time;        // offset 0: time
// data[1] is padding
data[2] = width;       // offset 8: resolution.x
data[3] = height;      // offset 12: resolution.y

ubo.write(data);
```

### Multiple Draws in One Render Pass

Use a single `pass()` callback with multiple setPipeline/draw calls:

```js
gpu.pass({ target: fbo, clear: [0, 0, 0, 1] }, (p) => {
  // Draw background
  p.setPipeline(bgPipe);
  p.setBindGroup(0, bgBG);
  p.draw(3);

  // Draw particles on top
  p.setPipeline(particlePipe);
  p.setBindGroup(0, particleBG);
  p.draw(4, instanceCount);
});
```

This is more efficient than separate passes because it avoids redundant load/store operations and (with MSAA) resolves only once at the end.
