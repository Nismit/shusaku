/**
* ChottoGPU: Minimal WebGPU Framework
*
* WebGL2 版 (esChottoGL.js) の WebGPU 対応版。
* - WebGPU 非対応環境では即 throw（フォールバックなし）
* - uniforms オブジェクトから自動でバインドグループを生成
* - Compute はフレームワーク統合 (dispatch)
*/

const FULLSCREEN_VERTEX = `
struct VOut {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.position = vec4f(pos[i], 0.0, 1.0);
  o.texCoord = pos[i] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}
`;

// std140 ではなく WGSL のデフォルト (std430 風) アライメントを採用。
// 各ホスト共有型の [size, alignment] (bytes)。
const WGSL_TYPE_INFO = {
  f32: [4, 4], i32: [4, 4], u32: [4, 4],
  'vec2<f32>': [8, 8], 'vec2f': [8, 8],
  'vec2<i32>': [8, 8], 'vec2<u32>': [8, 8],
  'vec3<f32>': [12, 16], 'vec3f': [12, 16],
  'vec3<i32>': [12, 16], 'vec3<u32>': [12, 16],
  'vec4<f32>': [16, 16], 'vec4f': [16, 16],
  'vec4<i32>': [16, 16], 'vec4<u32>': [16, 16],
  'mat2x2<f32>': [16, 8], 'mat2x2f': [16, 8],
  'mat3x3<f32>': [48, 16], 'mat3x3f': [48, 16],
  'mat4x4<f32>': [64, 16], 'mat4x4f': [64, 16],
};

const align = (offset, alignment) => Math.ceil(offset / alignment) * alignment;

/**
* WGSL ソースから struct 定義をパースし、フィールドのレイアウトを算出する。
* @returns {Object<string, {fields: Object<string, {offset, size, type}>, size}>}
*/
function parseStructs(source) {
  const structs = {};
  const structRegex = /struct\s+(\w+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = structRegex.exec(source)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields = {};
    let offset = 0;

    const fieldRegex = /(\w+)\s*:\s*([\w<>]+)\s*,?/g;
    let fmatch;
    while ((fmatch = fieldRegex.exec(body)) !== null) {
      const fieldName = fmatch[1];
      const fieldType = fmatch[2];
      const info = WGSL_TYPE_INFO[fieldType];
      if (!info) continue; // ネスト struct / 配列は非対応
      const [size, alignment] = info;
      offset = align(offset, alignment);
      fields[fieldName] = { offset, size, type: fieldType };
      offset += size;
    }

    structs[name] = { fields, size: align(offset, 16) };
  }
  return structs;
}

/**
* WGSL ソースから @group(G) @binding(B) のリソース宣言を抽出する。
* @returns {Array<{group, binding, name, kind, structName}>}
*/
function parseBindings(source) {
  const bindings = [];
  const regex = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([\w,\s]+)>)?\s+(\w+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const group = parseInt(match[1], 10);
    const binding = parseInt(match[2], 10);
    const addressSpace = (match[3] || '').split(',')[0].trim();
    const name = match[4];
    const type = match[5].trim();

    let kind;
    let structName = null;
    if (type.startsWith('sampler')) {
      kind = 'sampler';
    } else if (type.startsWith('texture_storage')) {
      kind = 'storageTexture';
    } else if (type.startsWith('texture')) {
      kind = 'texture';
    } else if (addressSpace === 'uniform') {
      kind = 'uniform';
      structName = type;
    } else if (addressSpace === 'storage') {
      kind = 'storage';
    } else {
      kind = 'uniform';
      structName = type;
    }

    bindings.push({ group, binding, name, kind, structName, addressSpace });
  }
  // vertex/fragment で同一ソースを共有する場合などに重複するため group:binding で排除
  const seen = new Set();
  return bindings.filter(b => {
    const key = `${b.group}:${b.binding}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
* Initialize the framework and return a wrapper object
* @param {HTMLCanvasElement} canvas
* @param {Object} [options] - { powerPreference, requiredFeatures, requiredLimits }
* @returns {Promise<Object>} ChottoGPU framework object
*/
export async function chottoGPU(canvas, options = {}) {
  if (!navigator.gpu) throw new Error('WebGPU not supported');

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: options.powerPreference || 'high-performance',
  });
  if (!adapter) throw new Error('No appropriate GPUAdapter found');

  const device = await adapter.requestDevice({
    requiredFeatures: options.requiredFeatures || [],
    requiredLimits: options.requiredLimits || {},
  });

  // WebGPU の検証エラーは例外ではなく uncapturederror で非同期通知される。
  // (try/catch では捕まらないため、ここで拾って onError か console に流す)
  const onError = options.onError || ((err) => console.error('WebGPU:', err));
  device.addEventListener('uncapturederror', (e) => onError(e.error));

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  // 共有デフォルトサンプラー (linear, clamp-to-edge)
  const defaultSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  // dispose 用リソース追跡
  const resources = {
    pipelines: [],
    framebuffers: [],
    buffers: [],
  };

  let resizeHandler = null;

  // フレームスコープ中はこのエンコーダに全パスを記録し、frame() 終了時に1回だけ submit する。
  // null のときは各パスが自前のエンコーダで即時 submit する（フォールバック）。
  let frameEncoder = null;
  let frameId = 0; // frame() ごとにインクリメント。フレーム内の uniform 出現回数リセットに使う。

  // BindGroup キャッシュ用に GPU リソース実体へ安定 ID を振る。
  // (GPUTextureView / GPUBuffer / GPUSampler は実体が変わったときだけ別 ID になる)
  const resourceIds = new WeakMap();
  let nextResourceId = 1;
  const idOf = (obj) => {
    let id = resourceIds.get(obj);
    if (id === undefined) { id = nextResourceId++; resourceIds.set(obj, id); }
    return id;
  };
  // 1 グループあたりのキャッシュ上限 (ping-pong=2, bloom blur=最大8。resize 時の旧 BindGroup を溢れさせる)
  const MAX_CACHED_BINDGROUPS = 16;

  // --- バインディング解決: uniforms オブジェクト → GPUBindGroup ---
  // フィールド名 → そのフィールドを含む uniform バインディング のマップを作る。
  const buildBindingIndex = (bindings, structs) => {
    // group 番号ごとに分類
    const byGroup = {};
    // uniform フィールド名 → { binding, field } 逆引き
    const fieldOwners = {};
    for (const b of bindings) {
      (byGroup[b.group] ||= []).push(b);
      if (b.kind === 'uniform' && structs[b.structName]) {
        for (const fieldName in structs[b.structName].fields) {
          fieldOwners[fieldName] = b;
        }
      }
    }
    return { byGroup, fieldOwners };
  };

  // uniform バインディング用の GPUBuffer を確保・再利用する。
  // フレームをバッチ化 (frame()) すると writeBuffer はキュー順で実行されるため、同一パイプラインを
  // 1フレーム内で複数回描くと最後の書き込み値を全ドローが読んでしまう。これを避けるため
  // フレーム内の「出現回数」ごとに別バッファを割り当てる (即時モードでは常に出現0で従来通り)。
  const ensureUniformBuffer = (pipelineObj, binding, byteSize) => {
    const bkey = `${binding.group}:${binding.binding}`;
    let occ = 0;
    if (frameEncoder) {
      if (pipelineObj._uniformFrameId !== frameId) {
        pipelineObj._uniformFrameId = frameId;
        pipelineObj._uniformOcc.clear();
      }
      occ = pipelineObj._uniformOcc.get(bkey) || 0;
      pipelineObj._uniformOcc.set(bkey, occ + 1);
    }
    const key = `${bkey}:${occ}`;
    let buf = pipelineObj._uniformBuffers.get(key);
    if (!buf) {
      buf = device.createBuffer({
        size: Math.max(byteSize, 16),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      pipelineObj._uniformBuffers.set(key, buf);
    }
    return buf;
  };

  // uniforms オブジェクトを使ってパイプラインの全 group のバインドグループを生成。
  // BindGroup はバインド対象リソースの実体が変わったときだけ作り直す (値の変化では再生成しない)。
  const resolveBindGroups = (pipelineObj, uniforms) => {
    const { byGroup, fieldOwners } = pipelineObj._bindingIndex;
    const structs = pipelineObj._structs;
    const gpuPipeline = pipelineObj.pipeline;
    const cache = pipelineObj._bindGroupCache;

    // uniform バッファに書き込むデータを binding ごとに集約
    const uniformWrites = new Map(); // key → { buffer, struct, values: {field: val} }

    const bindGroups = [];

    for (const groupStr in byGroup) {
      const group = parseInt(groupStr, 10);
      const entries = [];
      const sigParts = []; // バインド対象リソースの実体 ID 列 = キャッシュキー

      for (const b of byGroup[group]) {
        let resource, sigObj;
        if (b.kind === 'sampler') {
          sigObj = uniforms[b.name] || defaultSampler;
          resource = sigObj;
        } else if (b.kind === 'texture' || b.kind === 'storageTexture') {
          const val = uniforms[b.name];
          if (val === undefined) throw new Error(`Missing texture binding "${b.name}"`);
          sigObj = val.view ? val.view : (val.createView ? val.createView() : val);
          resource = sigObj;
        } else if (b.kind === 'storage') {
          const val = uniforms[b.name];
          if (val === undefined) throw new Error(`Missing storage binding "${b.name}"`);
          sigObj = val.buffer ? val.buffer : val;
          resource = { buffer: sigObj };
        } else { // uniform: 値が変わっても実体 (フレーム内出現ごとに固定) は安定 → BindGroup を使い回す
          const struct = structs[b.structName];
          const buf = ensureUniformBuffer(pipelineObj, b, struct ? struct.size : 16);
          const key = `${b.group}:${b.binding}`;
          if (!uniformWrites.has(key)) uniformWrites.set(key, { buffer: buf, struct, values: {} });
          sigObj = buf;
          resource = { buffer: buf };
        }
        entries.push({ binding: b.binding, resource });
        sigParts.push(`${b.binding}:${idOf(sigObj)}`);
      }

      const sig = sigParts.join(',');
      let groupCache = cache.get(group);
      if (!groupCache) { groupCache = new Map(); cache.set(group, groupCache); }
      let bindGroup = groupCache.get(sig);
      if (!bindGroup) {
        bindGroup = device.createBindGroup({
          layout: gpuPipeline.getBindGroupLayout(group),
          entries,
        });
        groupCache.set(sig, bindGroup);
        if (groupCache.size > MAX_CACHED_BINDGROUPS) {
          groupCache.delete(groupCache.keys().next().value); // 最古を破棄 (resize 後の旧 view 等)
        }
      }
      bindGroups.push({ group, bindGroup });
    }

    // uniform フィールド値を集約してバッファに書き込む
    for (const fieldName in uniforms) {
      const owner = fieldOwners[fieldName];
      if (!owner) continue;
      const key = `${owner.group}:${owner.binding}`;
      const write = uniformWrites.get(key);
      if (write) write.values[fieldName] = uniforms[fieldName];
    }

    for (const { buffer, struct, values } of uniformWrites.values()) {
      if (!struct) continue;
      const data = new ArrayBuffer(struct.size);
      const f32 = new Float32Array(data);
      const i32 = new Int32Array(data);
      const u32 = new Uint32Array(data);
      for (const fieldName in values) {
        const field = struct.fields[fieldName];
        if (!field) continue;
        const val = values[fieldName];
        const wordOffset = field.offset / 4;
        const arr = field.type.includes('i32') ? i32
          : field.type.includes('u32') ? u32 : f32;
        if (Array.isArray(val) || ArrayBuffer.isView(val)) {
          arr.set(val, wordOffset);
        } else {
          arr[wordOffset] = val;
        }
      }
      device.queue.writeBuffer(buffer, 0, data);
    }

    return bindGroups;
  };

  const applyBindGroups = (encoder, bindGroups) => {
    for (const { group, bindGroup } of bindGroups) {
      encoder.setBindGroup(group, bindGroup);
    }
  };

  // --- レンダーパイプライン ---
  function createPipeline(opts) {
    const hasCustomVertex = !!opts.vertex;
    const vertexSource = hasCustomVertex ? opts.vertex : FULLSCREEN_VERTEX;
    const fragmentSource = opts.fragment;

    // パース対象は vertex + fragment 全体
    const combined = `${vertexSource}\n${fragmentSource}`;
    const structs = parseStructs(combined);
    const bindings = parseBindings(combined);

    const vertexModule = device.createShaderModule({ code: vertexSource });
    const fragmentModule = opts.fragment
      ? (hasCustomVertex && opts.fragment === opts.vertex
        ? vertexModule
        : device.createShaderModule({ code: fragmentSource }))
      : null;

    // フォーマット解決順: targets > format ショートハンド > canvas デフォルト
    const targets = (opts.targets || [{ format: opts.format || format }]).map(t => ({
      format: t.format || opts.format || format,
      blend: t.blend || opts.blend,
      writeMask: t.writeMask,
    }));

    const descriptor = {
      layout: 'auto',
      vertex: {
        module: vertexModule,
        entryPoint: opts.vertexEntry || 'vs',
        buffers: opts.vertexBuffers || [],
      },
      fragment: {
        module: fragmentModule,
        entryPoint: opts.fragmentEntry || 'fs',
        targets,
      },
      primitive: {
        topology: opts.topology || 'triangle-list',
        cullMode: opts.cullMode || 'none',
      },
    };

    if (opts.samples && opts.samples > 1) {
      descriptor.multisample = { count: opts.samples };
    }

    if (opts.depthTest || opts.depthFormat) {
      descriptor.depthStencil = {
        format: opts.depthFormat || 'depth24plus',
        depthWriteEnabled: opts.depthWrite !== false,
        depthCompare: opts.depthCompare || 'less',
      };
    }

    const pipeline = device.createRenderPipeline(descriptor);

    const pipelineObj = {
      pipeline,
      _type: 'render',
      _structs: structs,
      _bindings: bindings,
      _bindingIndex: buildBindingIndex(bindings, structs),
      _uniformBuffers: new Map(),     // `${group}:${binding}:${occurrence}` → GPUBuffer
      _uniformOcc: new Map(),         // フレーム内の binding 出現回数
      _uniformFrameId: -1,
      _bindGroupCache: new Map(),     // group → (sig → GPUBindGroup)
      dispose() {
        for (const buf of this._uniformBuffers.values()) buf.destroy();
        this._uniformBuffers.clear();
        this._uniformOcc.clear();
        this._bindGroupCache.clear();
      },
    };

    resources.pipelines.push(pipelineObj);
    return pipelineObj;
  }

  // --- コンピュートパイプライン ---
  function createCompute(opts) {
    const source = opts.shader;
    const structs = parseStructs(source);
    const bindings = parseBindings(source);
    const module = device.createShaderModule({ code: source });

    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: opts.entryPoint || 'main' },
    });

    const pipelineObj = {
      pipeline,
      _type: 'compute',
      _structs: structs,
      _bindings: bindings,
      _bindingIndex: buildBindingIndex(bindings, structs),
      _uniformBuffers: new Map(),     // `${group}:${binding}:${occurrence}` → GPUBuffer
      _uniformOcc: new Map(),         // フレーム内の binding 出現回数
      _uniformFrameId: -1,
      _bindGroupCache: new Map(),     // group → (sig → GPUBindGroup)
      dispose() {
        for (const buf of this._uniformBuffers.values()) buf.destroy();
        this._uniformBuffers.clear();
        this._uniformOcc.clear();
        this._bindGroupCache.clear();
      },
    };

    resources.pipelines.push(pipelineObj);
    return pipelineObj;
  }

  // --- 内部: レンダーパスを実行 ---
  // draws: [{ pipeline, uniforms }] の配列。複数指定すると同一レンダーパス内に順に記録され、
  // MSAA リゾルブ (resolveView) もパス末尾で1回だけ行われる。
  // clear / loadOp は先頭ドローの uniforms._clear で決まる。
  const runRenderPass = (colorView, depthView, draws, resolveView = null) => {
    const encoder = frameEncoder ?? device.createCommandEncoder();
    const clear = draws[0].uniforms?._clear;

    const colorAttachment = {
      view: colorView,
      clearValue: clear || { r: 0, g: 0, b: 0, a: 1 },
      loadOp: clear === false ? 'load' : 'clear',
      storeOp: 'store',
    };
    if (resolveView) colorAttachment.resolveTarget = resolveView;

    const passDesc = { colorAttachments: [colorAttachment] };
    if (depthView) {
      passDesc.depthStencilAttachment = {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: clear === false ? 'load' : 'clear',
        depthStoreOp: 'store',
      };
    }

    const pass = encoder.beginRenderPass(passDesc);

    for (const { pipeline, uniforms } of draws) {
      if (typeof pipeline === 'function') {
        pipeline(pass);
        continue;
      }
      pass.setPipeline(pipeline.pipeline);
      applyBindGroups(pass, resolveBindGroups(pipeline, uniforms || {}));
      // フルスクリーンクアッド (3頂点) かカスタムか
      pass.draw(uniforms?._vertexCount ?? 3, uniforms?._instanceCount ?? 1);
    }

    pass.end();
    if (!frameEncoder) device.queue.submit([encoder.finish()]);
  };

  // pass() 引数を draws 配列に正規化。単一の pipeline/callback も配列も受ける。
  const toDraws = (arg, uniforms) =>
    Array.isArray(arg) ? arg : [{ pipeline: arg, uniforms }];

  // --- フレームバッファ (オフスクリーンレンダーターゲット) ---
  function createFramebuffer(width, height, options = {}) {
    const texFormat = options.format || format;
    const samples = options.samples && options.samples > 1 ? options.samples : 1;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | (options.storage ? GPUTextureUsage.STORAGE_BINDING : 0);

    const fb = {
      width, height,
      format: texFormat,
      samples,
      depthFormat: options.depth ? (options.depthFormat || 'depth24plus') : null,
      texture: null,      // サンプリング用 (リゾルブ済み単一サンプル)
      view: null,
      depthTexture: null,
      depthView: null,
      msTexture: null,    // MSAA レンダーターゲット (samples>1 のみ)
      msView: null,

      _create() {
        // サンプリング対象は常に単一サンプルテクスチャ
        this.texture = device.createTexture({
          size: [this.width, this.height],
          format: this.format,
          usage,
        });
        this.view = this.texture.createView();

        if (samples > 1) {
          // 描画先の multisample テクスチャ (RENDER_ATTACHMENT のみ)
          this.msTexture = device.createTexture({
            size: [this.width, this.height],
            format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            sampleCount: samples,
          });
          this.msView = this.msTexture.createView();
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

      // 単一の pipeline/callback、または [{ pipeline, uniforms }] 配列 (1パス複数ドロー) を受ける。
      pass(arg, uniforms) {
        const draws = toDraws(arg, uniforms);
        if (samples > 1) {
          // multisample に描画 → texture (単一サンプル) にリゾルブ
          runRenderPass(this.msView, this.depthView, draws, this.view);
        } else {
          runRenderPass(this.view, this.depthView, draws);
        }
        return this;
      },

      resize(w, h) {
        this.width = w;
        this.height = h;
        this.texture?.destroy();
        this.msTexture?.destroy();
        this.depthTexture?.destroy();
        this._create();
        return this;
      },

      dispose() {
        this.texture?.destroy();
        this.msTexture?.destroy();
        this.depthTexture?.destroy();
        return this;
      },
    };

    fb._create();
    resources.framebuffers.push(fb);
    return fb;
  }

  // --- バッファ (storage / uniform / vertex) ---
  function createBuffer(data, options = {}) {
    const isView = ArrayBuffer.isView(data);
    const byteLength = isView ? data.byteLength : data;

    let usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    if (options.storage) usage |= GPUBufferUsage.STORAGE;
    if (options.uniform) usage |= GPUBufferUsage.UNIFORM;
    if (options.vertex) usage |= GPUBufferUsage.VERTEX;
    if (options.index) usage |= GPUBufferUsage.INDEX;
    if (options.usage) usage |= options.usage;
    // デフォルトは storage
    if (!options.storage && !options.uniform && !options.vertex && !options.index && !options.usage) {
      usage |= GPUBufferUsage.STORAGE;
    }

    const buffer = device.createBuffer({ size: align(byteLength, 4), usage });
    if (isView) device.queue.writeBuffer(buffer, 0, data);

    const bufObj = {
      buffer,
      size: byteLength,

      write(newData, offset = 0) {
        device.queue.writeBuffer(buffer, offset, newData);
        return this;
      },

      async read(outputArray) {
        const staging = device.createBuffer({
          size: align(byteLength, 4),
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(buffer, 0, staging, 0, align(byteLength, 4));
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const mapped = new outputArray.constructor(staging.getMappedRange());
        outputArray.set(mapped.subarray(0, outputArray.length));
        staging.unmap();
        staging.destroy();
        return outputArray;
      },

      dispose() {
        buffer.destroy();
        return this;
      },
    };

    resources.buffers.push(bufObj);
    return bufObj;
  }

  // --- フレームワークオブジェクト ---
  const framework = {
    device,
    context,
    format,
    adapter,
    defaultSampler,

    createPipeline,
    createCompute,
    createFramebuffer,
    createBuffer,

    /** 画面 (canvas) に出力。単一 pipeline/callback または draws 配列を受ける。 */
    pass(arg, uniforms) {
      const view = context.getCurrentTexture().createView();
      runRenderPass(view, null, toDraws(arg, uniforms));
      return this;
    },

    /** コンピュートを実行 */
    dispatch(pipelineObj, workgroups, uniforms) {
      const encoder = frameEncoder ?? device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipelineObj.pipeline);
      const bindGroups = resolveBindGroups(pipelineObj, uniforms || {});
      applyBindGroups(pass, bindGroups);
      const [x = 1, y = 1, z = 1] = workgroups;
      pass.dispatchWorkgroups(x, y, z);
      pass.end();
      if (!frameEncoder) device.queue.submit([encoder.finish()]);
      return this;
    },

    /**
     * フレームスコープ。コールバック中の全パス/dispatch を単一のコマンドエンコーダに
     * 記録し、終了時に1回だけ submit する（WebGPU 推奨の1フレーム1サブミット）。
     * @param {(framework: Object) => void} cb
     */
    frame(cb) {
      if (frameEncoder) { cb(this); return this; } // ネストは外側のスコープに合流
      frameId++;
      frameEncoder = device.createCommandEncoder();
      try {
        cb(this);
        device.queue.submit([frameEncoder.finish()]);
      } finally {
        frameEncoder = null;
      }
      return this;
    },

    /** canvas をウィンドウサイズにフィットさせ、リサイズを監視 */
    fitWindow(callback) {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const resize = () => {
        canvas.width = Math.floor(window.innerWidth * pixelRatio);
        canvas.height = Math.floor(window.innerHeight * pixelRatio);
      };
      resize();
      resizeHandler = () => { resize(); callback?.(canvas.width, canvas.height); };
      window.addEventListener('resize', resizeHandler);
      return this;
    },

    dispose() {
      for (const p of resources.pipelines) p.dispose();
      for (const fb of resources.framebuffers) fb.dispose();
      for (const b of resources.buffers) b.dispose();
      resources.pipelines.length = 0;
      resources.framebuffers.length = 0;
      resources.buffers.length = 0;
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      device.destroy();
      return this;
    },
  };

  return framework;
}
