/**
 * lilGPU — Minimal WebGPU Framework
 * See lilGPU.md for full API documentation and usage patterns.
 */

const FULLSCREEN_VERT = `
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VOut;
  o.position = vec4f(pos[i], 0, 1);
  o.uv = pos[i] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}`;

const align4 = (n) => (n + 3) & ~3;

export async function lilGPU(canvas, options = {}) {
  if (!navigator.gpu) throw new Error('WebGPU not supported');

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: options.powerPreference || 'high-performance',
  });
  if (!adapter) throw new Error('No GPUAdapter found');

  const device = await adapter.requestDevice({
    requiredFeatures: options.requiredFeatures || [],
    requiredLimits: options.requiredLimits || {},
  });

  const onError = options.onError || ((e) => console.error('WebGPU:', e));
  device.addEventListener('uncapturederror', (e) => onError(e.error));

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  const sampler = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  const tracked = { framebuffers: [], buffers: [] };
  let frameEncoder = null;
  let resizeHandler = null;

  // --- pipeline ---

  function pipeline(opts) {
    const vertSrc = opts.vertex || FULLSCREEN_VERT;
    const fragSrc = opts.fragment;
    const vertModule = device.createShaderModule({ code: vertSrc });
    const fragModule = vertSrc === fragSrc
      ? vertModule
      : device.createShaderModule({ code: fragSrc });

    const formats = opts.format
      ? (Array.isArray(opts.format) ? opts.format : [opts.format])
      : [format];
    const targets = formats.map((f) => ({
      format: f,
      blend: opts.blend,
    }));

    const desc = {
      layout: 'auto',
      vertex: {
        module: vertModule,
        entryPoint: opts.vertexEntry || 'vs',
        buffers: opts.vertexBuffers || [],
      },
      fragment: {
        module: fragModule,
        entryPoint: opts.fragmentEntry || 'fs',
        targets,
      },
      primitive: {
        topology: opts.topology || 'triangle-list',
        cullMode: opts.cullMode || 'none',
      },
    };

    if (opts.samples > 1) desc.multisample = { count: opts.samples };

    if (opts.depthTest || opts.depthFormat) {
      desc.depthStencil = {
        format: opts.depthFormat || 'depth24plus',
        depthWriteEnabled: opts.depthWrite !== false,
        depthCompare: opts.depthCompare || 'less',
      };
    }

    return device.createRenderPipeline(desc);
  }

  // --- compute ---

  function compute(opts) {
    const module = device.createShaderModule({ code: opts.shader });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: opts.entryPoint || 'main' },
    });
  }

  // --- framebuffer ---

  function framebuffer(width, height, opts = {}) {
    const colorFormats = opts.colorFormats || [opts.format || format];
    const samples = opts.samples > 1 ? opts.samples : 1;
    const depthFmt = opts.depth ? (opts.depthFormat || 'depth24plus') : null;
    const colorUsage = GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | (opts.storage ? GPUTextureUsage.STORAGE_BINDING : 0);

    const fb = {
      width, height, samples, colorFormats, depthFormat: depthFmt,
      textures: [], views: [],
      msTextures: [], msViews: [],
      depthTexture: null, depthView: null,
      get texture() { return this.textures[0]; },
      get view() { return this.views[0]; },

      _build() {
        for (const fmt of this.colorFormats) {
          const tex = device.createTexture({
            size: [this.width, this.height],
            format: fmt, usage: colorUsage,
          });
          this.textures.push(tex);
          this.views.push(tex.createView());

          if (samples > 1) {
            const ms = device.createTexture({
              size: [this.width, this.height],
              format: fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT,
              sampleCount: samples,
            });
            this.msTextures.push(ms);
            this.msViews.push(ms.createView());
          }
        }

        if (this.depthFormat) {
          this.depthTexture = device.createTexture({
            size: [this.width, this.height],
            format: this.depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            sampleCount: samples,
          });
          this.depthView = this.depthTexture.createView();
        }
      },

      _destroy() {
        for (const t of this.textures) t.destroy();
        for (const t of this.msTextures) t.destroy();
        this.depthTexture?.destroy();
        this.textures.length = 0;
        this.views.length = 0;
        this.msTextures.length = 0;
        this.msViews.length = 0;
        this.depthTexture = null;
        this.depthView = null;
      },

      resize(w, h) {
        this.width = w;
        this.height = h;
        this._destroy();
        this._build();
        return this;
      },

      dispose() {
        this._destroy();
      },
    };

    fb._build();
    tracked.framebuffers.push(fb);
    return fb;
  }

  // --- buffer ---

  function buffer(data, opts = {}) {
    const isView = ArrayBuffer.isView(data);
    const byteLength = isView ? data.byteLength : data;

    let usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    if (opts.storage) usage |= GPUBufferUsage.STORAGE;
    if (opts.uniform) usage |= GPUBufferUsage.UNIFORM;
    if (opts.vertex) usage |= GPUBufferUsage.VERTEX;
    if (opts.index) usage |= GPUBufferUsage.INDEX;
    if (opts.usage) usage |= opts.usage;
    if (!(usage & (GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX))) {
      usage |= GPUBufferUsage.STORAGE;
    }

    const gpuBuf = device.createBuffer({ size: align4(byteLength), usage });
    if (isView) device.queue.writeBuffer(gpuBuf, 0, data);

    const obj = {
      buffer: gpuBuf,
      size: byteLength,

      write(newData, offset = 0) {
        device.queue.writeBuffer(gpuBuf, offset, newData);
        return this;
      },

      async read(out) {
        const size = align4(byteLength);
        const staging = device.createBuffer({
          size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const enc = device.createCommandEncoder();
        enc.copyBufferToBuffer(gpuBuf, 0, staging, 0, size);
        device.queue.submit([enc.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const mapped = new out.constructor(staging.getMappedRange());
        out.set(mapped.subarray(0, out.length));
        staging.unmap();
        staging.destroy();
        return out;
      },

      dispose() { gpuBuf.destroy(); },
    };

    tracked.buffers.push(obj);
    return obj;
  }

  // --- pass ---

  function buildColorAttachments(target, clear) {
    if (!target) {
      const clearVal = clear === false ? undefined
        : Array.isArray(clear) ? { r: clear[0], g: clear[1], b: clear[2], a: clear[3] }
        : clear || { r: 0, g: 0, b: 0, a: 1 };
      return [{
        view: context.getCurrentTexture().createView(),
        clearValue: clearVal,
        loadOp: clear === false ? 'load' : 'clear',
        storeOp: 'store',
      }];
    }

    const clearVal = Array.isArray(clear) ? { r: clear[0], g: clear[1], b: clear[2], a: clear[3] }
      : clear && clear !== false ? clear
      : { r: 0, g: 0, b: 0, a: 1 };
    const loadOp = clear === false ? 'load' : 'clear';
    const hasMSAA = target.samples > 1;

    return target.views.map((view, i) => {
      const att = {
        view: hasMSAA ? target.msViews[i] : view,
        clearValue: clearVal,
        loadOp,
        storeOp: 'store',
      };
      if (hasMSAA) att.resolveTarget = view;
      return att;
    });
  }

  function pass(optsOrFn, maybeFn) {
    let opts, fn;
    if (typeof optsOrFn === 'function') { opts = {}; fn = optsOrFn; }
    else { opts = optsOrFn || {}; fn = maybeFn; }

    const encoder = frameEncoder || device.createCommandEncoder();
    const target = opts.target;
    const colorAttachments = buildColorAttachments(target, opts.clear);

    const passDesc = { colorAttachments };
    const depthView = target?.depthView;
    if (depthView) {
      passDesc.depthStencilAttachment = {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: opts.clear === false ? 'load' : 'clear',
        depthStoreOp: 'store',
      };
    }

    const p = encoder.beginRenderPass(passDesc);
    fn(p);
    p.end();
    if (!frameEncoder) device.queue.submit([encoder.finish()]);
    return gpu;
  }

  // --- dispatch ---

  function dispatch(fn) {
    const encoder = frameEncoder || device.createCommandEncoder();
    const p = encoder.beginComputePass();
    fn(p);
    p.end();
    if (!frameEncoder) device.queue.submit([encoder.finish()]);
    return gpu;
  }

  // --- frame ---

  function frame(fn) {
    if (frameEncoder) { fn(gpu); return gpu; }
    frameEncoder = device.createCommandEncoder();
    try {
      fn(gpu);
      device.queue.submit([frameEncoder.finish()]);
    } finally {
      frameEncoder = null;
    }
    return gpu;
  }

  // --- fitWindow ---

  function fitWindow(callback) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    resizeHandler = () => { resize(); callback?.(canvas.width, canvas.height); };
    window.addEventListener('resize', resizeHandler);
    return gpu;
  }

  // --- dispose ---

  function dispose() {
    for (const fb of tracked.framebuffers) fb.dispose();
    for (const b of tracked.buffers) b.dispose();
    tracked.framebuffers.length = 0;
    tracked.buffers.length = 0;
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    device.destroy();
  }

  // --- framework object ---

  const gpu = {
    device, context, format, adapter, sampler,
    FULLSCREEN_VERT,
    pipeline, compute, framebuffer, buffer,
    pass, dispatch, frame,
    fitWindow, dispose,
  };

  return gpu;
}
