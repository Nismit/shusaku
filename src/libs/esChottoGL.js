/**
* ChottoGL: Minimal WebGL2 Framework
*/

/**
* Initialize the framework and return a wrapper object
* @param {HTMLCanvasElement} canvas - Canvas element
* @param {Object} [options={}] - WebGL context options
* @returns {Object} ChottoGL framework object
*/
export function chottoGL(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', options);
  if (!gl) throw new Error('WebGL2 not supported');

  // GL constants aliases
  const GL_TEX2D = gl.TEXTURE_2D;
  const GL_FB = gl.FRAMEBUFFER;
  const GL_AB = gl.ARRAY_BUFFER;
  const GL_UB = gl.UNIFORM_BUFFER;
  const GL_RB = gl.RENDERBUFFER;
  const GL_TF = gl.TRANSFORM_FEEDBACK;
  const GL_TFB = gl.TRANSFORM_FEEDBACK_BUFFER;

  // Enable extensions
  const extensions = {};
  (options.extensions || []).forEach(name => {
    const ext = gl.getExtension(name);
    if (ext) extensions[name] = ext;
  });

  // No-op fragment shader for transform feedback (rasterizer discarded)
  const noopFragmentShader = `#version 300 es
    precision highp float;
    out vec4 fragColor;
    void main() { fragColor = vec4(0.0); }`;

  // Default shaders
  const defaultShaders = {
    vertex: `#version 300 es
      in vec4 aPosition;
      in vec2 aTexCoord;
      out vec2 vTexCoord;
      void main() {
        vTexCoord = aTexCoord;
        gl_Position = aPosition;
      }`,
    fragment: `#version 300 es
      precision highp float;
      in vec2 vTexCoord;
      uniform sampler2D uTexture;
      out vec4 fragColor;
      void main() {
        fragColor = texture(uTexture, vTexCoord);
      }`
  };

  const uniformRegex = /uniform\s+([\w]+)\s+([\w]+)(?:\s*\[\s*(\d+)\s*\])?;/g;

  // Uniform setter map
  // Uniform setter generators
  const samplerSetter = (loc, val) => gl.uniform1i(loc, val);
  const vecSetter = (n, t) => (loc, val) => gl[`uniform${n}${t}v`](loc, val);
  const matSetter = n => (loc, val) => gl[`uniformMatrix${n}fv`](loc, false, val);
  const setterMap = {
    mat2: matSetter(2), mat3: matSetter(3), mat4: matSetter(4),
    sampler2D: samplerSetter, samplerCube: samplerSetter,
    sampler3D: samplerSetter, sampler2DArray: samplerSetter,
    vec2: vecSetter(2,'f'), vec3: vecSetter(3,'f'), vec4: vecSetter(4,'f'),
    ivec2: vecSetter(2,'i'), ivec3: vecSetter(3,'i'), ivec4: vecSetter(4,'i'),
  };

  // Common utility functions
  const createBuffer = (data, usage = gl.STATIC_DRAW) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(GL_AB, buffer);
    gl.bufferData(GL_AB, data, usage);
    return buffer;
  };

  const createTF = (buffers) => {
    const tf = gl.createTransformFeedback();
    gl.bindTransformFeedback(GL_TF, tf);
    buffers.forEach((buffer, i) => {
      gl.bindBufferBase(GL_TFB, i, buffer);
    });
    gl.bindTransformFeedback(GL_TF, null);
    return tf;
  };

  const setTexParams = (o) => {
    const p = [['MIN_FILTER',o.minFilter],['MAG_FILTER',o.magFilter],['WRAP_S',o.wrapS],['WRAP_T',o.wrapT]];
    p.forEach(([k,v]) => gl.texParameteri(GL_TEX2D, gl[`TEXTURE_${k}`], v));
  };

  // VAO creation helper
  const createVAO = (attribs) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    attribs.forEach(attrib => {
      gl.bindBuffer(GL_AB, attrib.buffer);
      gl.enableVertexAttribArray(attrib.index);
      gl.vertexAttribPointer(
        attrib.index,
        attrib.size,
        attrib.type || gl.FLOAT,
        attrib.normalized || false,
        attrib.stride || 0,
        attrib.offset || 0
      );
    });

    gl.bindVertexArray(null);
    return vao;
  };

  // Preprocess shader source to add boilerplate
  function preprocessShaderSource(source, type, raw = false) {
    if (raw) return source;

    if (/^\s*#version\s/.test(source)) return source;

    const lines = ['#version 300 es', 'precision highp float;'];

    if (type === 'fragment') {
      if (!/in\s+vec2\s+vTexCoord\s*;/.test(source)) {
        lines.push('in vec2 vTexCoord;');
      }
      if (!/out\s+vec4\s+fragColor\s*;/.test(source)) {
        lines.push('out vec4 fragColor;');
      }
    }

    lines.push('#line 1'); // Keep error line numbers correct
    return lines.join('\n') + '\n' + source;
  }

  // Compile shader helper
  const compileShader = (source, type, originalSource = null) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);

      const shaderType = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
      const errorMatch = info.match(/ERROR:\s+\d+:(\d+):/);
      let errorMsg = `${shaderType} Shader Error: ${info}`;

      if (errorMatch && errorMatch[1]) {
        const lineNum = parseInt(errorMatch[1], 10);
        const displaySource = originalSource || source;
        const lines = displaySource.split('\n');
        errorMsg = `${shaderType} Error line ${lineNum}: ${lines[lineNum - 1] || ''}\n${info}`;
      }

      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    return shader;
  };

  const quadVerts = new Float32Array([-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1]);
  const quadBuffer = createBuffer(quadVerts);
  const quadVAO = createVAO([
    { buffer: quadBuffer, size: 2, stride: 16, offset: 0, index: 0 },
    { buffer: quadBuffer, size: 2, stride: 16, offset: 8, index: 1 }
  ]);

  // Extract uniform declarations from shader source
  function parseUniforms(source) {
    const uniforms = {};
    uniformRegex.lastIndex = 0;
    let match;
    while ((match = uniformRegex.exec(source)) !== null) {
      uniforms[match[2]] = {
        type: match[1],
        isArray: match[3] !== undefined,
        arraySize: match[3] ? parseInt(match[3], 10) : 0
      };
    }
    return uniforms;
  }

  // Get uniform setter function based on type
  const makeScalarSetter = (suffix, arrayType) => (isArray) => {
    const arrayFn = (loc, val) => gl[`uniform1${suffix}v`](loc, val);
    if (isArray) return arrayFn;
    return (loc, val) => {
      if (Array.isArray(val) || val instanceof arrayType) {
        const len = val.length;
        (len > 0 && len <= 4) ? gl[`uniform${len}${suffix}`](loc, ...val) : arrayFn(loc, val);
      } else {
        gl[`uniform1${suffix}`](loc, val);
      }
    };
  };
  const floatSetter = makeScalarSetter('f', Float32Array);
  const intSetter = makeScalarSetter('i', Int32Array);

  function getUniformSetter(type, isArray) {
    if (setterMap[type]) return setterMap[type];
    if (type === 'float') return floatSetter(isArray);
    if (type === 'int' || type === 'bool') return intSetter(isArray);
    console.warn(`Unsupported uniform type: ${type}`);
    return () => {};
  }

  /**
   * Creates a shader program
   */
  function createShader(options) {
    const program = gl.createProgram();
    const raw = options.raw === true;

    const rawVertexSource = options.vertex || defaultShaders.vertex;
    const rawFragmentSource = options.fragment ||
      (options.transformFeedbackVaryings?.length > 0 ? noopFragmentShader : defaultShaders.fragment);

    const isDefaultVertex = !options.vertex;
    const isDefaultFragment = !options.fragment;

    const vertexSource = isDefaultVertex ? rawVertexSource :
      preprocessShaderSource(rawVertexSource, 'vertex', raw);
    const fragmentSource = isDefaultFragment ? rawFragmentSource :
      preprocessShaderSource(rawFragmentSource, 'fragment', raw);

    const parsedUniforms = {
      ...parseUniforms(vertexSource),
      ...parseUniforms(fragmentSource)
    };

    const vertShader = compileShader(vertexSource, gl.VERTEX_SHADER, isDefaultVertex ? null : rawVertexSource);
    const fragShader = compileShader(fragmentSource, gl.FRAGMENT_SHADER, isDefaultFragment ? null : rawFragmentSource);

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);

    if (options.transformFeedbackVaryings?.length > 0) {
      gl.transformFeedbackVaryings(
        program,
        options.transformFeedbackVaryings,
        options.transformFeedbackMode || gl.SEPARATE_ATTRIBS
      );
    }

    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('Program linking error: ' + info);
    }

    const uniformLocations = {};
    const uniformSetters = {};

    for (const name in parsedUniforms) {
      const info = parsedUniforms[name];
      const location = gl.getUniformLocation(program, name);

      if (location) {
        uniformLocations[name] = location;
        uniformSetters[name] = getUniformSetter(info.type, info.isArray);
      }
    }

    const warnedUniforms = new Set(); // Track warned uniforms to avoid repeated warnings

    const shaderObj = {
      program,
      uniforms: uniformLocations,

      use() {
        gl.useProgram(program);
        return this;
      },

      setUniform(name, value) {
        if (typeof name === 'object') {
          for (const key in name) this.setUniform(key, name[key]);
          return this;
        }

        const location = uniformLocations[name];
        if (!location) return this;

        if (typeof value === 'boolean') value = value ? 1 : 0;
        uniformSetters[name]?.(location, value);
        return this;
      },

      setTexture(name, texture) {
        if (!uniformLocations[name]) {
          if (!warnedUniforms.has(name)) {
            console.warn(`Texture uniform ${name} does not exist in shader`);
            warnedUniforms.add(name);
          }
          return this;
        }

        const tex = texture?.texture instanceof WebGLTexture ? texture.texture : texture;

        let unit = activeTextures[name];
        if (unit === undefined) {
          unit = textureUnit++;
          activeTextures[name] = unit;
        }

        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(GL_TEX2D, tex);
        gl.uniform1i(uniformLocations[name], unit);

        return this;
      },

      set(uniforms) {
        for (const name in uniforms) {
          const info = parsedUniforms[name];
          if (info && info.type.startsWith('sampler')) {
            this.setTexture(name, uniforms[name]);
          } else {
            this.setUniform(name, uniforms[name]);
          }
        }
        return this;
      },

      dispose() {
        gl.deleteProgram(program);
        return this;
      },

      draw(vao, mode, count) {
        gl.bindVertexArray(vao || quadVAO);
        gl.drawArrays(vao ? mode : gl.TRIANGLE_STRIP, 0, vao ? count : 4);
        gl.bindVertexArray(null);
        return this;
      },
    };

    resources.shaders.push(shaderObj);
    return shaderObj;
  }

  // Default object properties setup
  const defaultTexOpts = {
    internalFormat: gl.RGBA,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    minFilter: gl.LINEAR,
    magFilter: gl.LINEAR,
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE
  };
  const FLOAT32_FORMATS = [gl.R32F, gl.RG32F, gl.RGB32F, gl.RGBA32F];
  const LINEAR_FILTERS = [gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR_MIPMAP_NEAREST];

  // Helper to set default options
  const setDefaults = (opts, defs) => ({ ...defs, ...opts });

  // Common pass execution helper
  const runPass = (shaderOrCallback, uniforms) => {
    if (typeof shaderOrCallback === 'function') shaderOrCallback();
    else shaderOrCallback.use().set(uniforms).draw();
  };


  // Texture unit management (shared across all shaders)
  const activeTextures = {};
  let textureUnit = 0;

  // Resource tracking for dispose()
  const resources = {
    shaders: [],
    framebuffers: [],
    transformFeedbacks: [],
    ubos: [],
    textures: []
  };

  // Resize event listener reference for cleanup
  let resizeHandler = null;

  // Animation loop state
  let loopCallback = null;
  let loopId = null;
  let lastTime = 0;

  // Create framework object
  const framework = {
    gl,

    resize(width, height) {
      gl.viewport(0, 0, width, height);
      return this;
    },

    /**
     * Fit canvas to window and auto-resize on window resize
     * @param {Function} [callback] - Called with (width, height) on resize events only
     * @returns {Object} this
     */
    fitWindow(callback) {
      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      };
      resize();
      resizeHandler = () => { resize(); callback?.(canvas.width, canvas.height); };
      window.addEventListener('resize', resizeHandler);
      return this;
    },

    clear(r = 0.0, g = 0.0, b = 0.0, a = 1.0) {
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return this;
    },

    createShader,

    /**
     * Creates an audio buffer for GPU audio synthesis via Transform Feedback
     * @param {number} size - Number of samples per buffer
     * @param {number} [channels=1] - Number of audio channels
     * @returns {Object} Audio buffer object with process/readBack methods
     */
    createAudioBuffer(size, channels = 1) {
      const buffer = createBuffer(new ArrayBuffer(size * channels * 4), gl.DYNAMIC_COPY);
      const tf = createTF([buffer]);

      const obj = {
        buffer, tf, size, channels,

        process(program, setup) {
          gl.useProgram(program.program || program);
          gl.bindVertexArray(null);
          gl.bindBuffer(GL_AB, null);
          setup?.();
          gl.enable(gl.RASTERIZER_DISCARD);
          gl.bindTransformFeedback(GL_TF, tf);
          gl.beginTransformFeedback(gl.POINTS);
          gl.drawArrays(gl.POINTS, 0, size);
          gl.endTransformFeedback();
          gl.bindTransformFeedback(GL_TF, null);
          gl.disable(gl.RASTERIZER_DISCARD);
          return this;
        },

        readBack(out) {
          gl.bindBuffer(GL_AB, buffer);
          gl.getBufferSubData(GL_AB, 0, out);
          gl.bindBuffer(GL_AB, null);
          return this;
        },

        dispose() {
          gl.deleteBuffer(buffer);
          gl.deleteTransformFeedback(tf);
          return this;
        }
      };

      resources.transformFeedbacks.push(obj);
      return obj;
    },

    /**
     * Creates a particle buffer with ping-pong for GPU particle simulation
     * @param {Array<Float32Array>} dataArrays - Initial data arrays (e.g., [positions, velocities])
     * @returns {Object} Particle buffer object with process/draw methods
     */
    createParticleBuffer(dataArrays) {
      const count = dataArrays[0].length / 4;
      const usage = gl.DYNAMIC_COPY;

      const A = dataArrays.map(d => createBuffer(d, usage));
      const B = dataArrays.map(d => createBuffer(d, usage));
      const vaoA = createVAO(A.map((b, i) => ({ buffer: b, size: 4, index: i })));
      const vaoB = createVAO(B.map((b, i) => ({ buffer: b, size: 4, index: i })));
      const tfA = createTF(B);
      const tfB = createTF(A);

      let flip = true;

      const obj = {
        count,
        get vao() { return flip ? vaoA : vaoB; },
        get tf() { return flip ? tfA : tfB; },
        get buffers() { return flip ? A : B; },

        readBack(outputArrays) {
          const bufs = this.buffers;
          for (let i = 0; i < bufs.length && i < outputArrays.length; i++) {
            gl.bindBuffer(GL_AB, bufs[i]);
            gl.getBufferSubData(GL_AB, 0, outputArrays[i]);
          }
          gl.bindBuffer(GL_AB, null);
          return this;
        },

        process(program, setup, mode = gl.POINTS) {
          gl.useProgram(program.program || program);
          gl.bindVertexArray(null);
          gl.bindBuffer(GL_AB, null);
          setup?.();
          gl.enable(gl.RASTERIZER_DISCARD);
          gl.bindVertexArray(this.vao);
          gl.bindTransformFeedback(GL_TF, this.tf);
          gl.beginTransformFeedback(mode);
          gl.drawArrays(mode, 0, count);
          gl.endTransformFeedback();
          gl.bindTransformFeedback(GL_TF, null);
          gl.disable(gl.RASTERIZER_DISCARD);
          gl.bindVertexArray(null);
          flip = !flip;
          return this;
        },

        draw(shader, uniforms = {}, mode = gl.POINTS) {
          shader.use().set(uniforms).draw(this.vao, mode, count);
          return this;
        },

        dispose() {
          [...A, ...B].forEach(b => gl.deleteBuffer(b));
          gl.deleteVertexArray(vaoA);
          gl.deleteVertexArray(vaoB);
          gl.deleteTransformFeedback(tfA);
          gl.deleteTransformFeedback(tfB);
          return this;
        }
      };

      resources.transformFeedbacks.push(obj);
      return obj;
    },

    /**
     * Creates a framebuffer
     */
    createFramebuffer(width, height, data = null, options = {}) {
      const opts = setDefaults(options, defaultTexOpts);
      const useMipmap = options.mipmap === true;

      const targetsOpt = options.targets;
      let targetConfigs = [];

      if (targetsOpt === undefined) {
        targetConfigs = [{ internalFormat: opts.internalFormat, format: opts.format, type: opts.type }];
      } else if (typeof targetsOpt === 'number') {
        for (let i = 0; i < targetsOpt; i++) {
          targetConfigs.push({ internalFormat: opts.internalFormat, format: opts.format, type: opts.type });
        }
      } else if (Array.isArray(targetsOpt)) {
        targetConfigs = targetsOpt.map(cfg => ({
          internalFormat: cfg.internalFormat ?? opts.internalFormat,
          format: cfg.format ?? opts.format,
          type: cfg.type ?? opts.type
        }));
      }

      const targetCount = targetConfigs.length;

      const isLinear = [opts.minFilter, opts.magFilter].some(f => LINEAR_FILTERS.includes(f));
      for (const cfg of targetConfigs) {
        const isFloat32 = FLOAT32_FORMATS.includes(cfg.internalFormat);
        if (isFloat32 && isLinear && !extensions['OES_texture_float_linear']) {
          throw new Error(
            'Float texture with LINEAR filter requires OES_texture_float_linear extension. ' +
            'Either enable the extension or use gl.NEAREST filter instead.'
          );
        }
      }

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(GL_FB, fbo);

      const textures = [];
      const drawBuffers = [];

      let minFilter = opts.minFilter;
      if (useMipmap && minFilter === gl.LINEAR) {
        minFilter = gl.LINEAR_MIPMAP_LINEAR;
      }

      for (let i = 0; i < targetCount; i++) {
        const cfg = targetConfigs[i];
        const texture = gl.createTexture();
        gl.bindTexture(GL_TEX2D, texture);
        gl.texImage2D(
          GL_TEX2D, 0, cfg.internalFormat, width, height, 0,
          cfg.format, cfg.type, i === 0 ? data : null
        );

        setTexParams({ ...opts, minFilter });

        if (useMipmap) gl.generateMipmap(GL_TEX2D);

        gl.framebufferTexture2D(
          GL_FB, gl.COLOR_ATTACHMENT0 + i, GL_TEX2D, texture, 0
        );

        textures.push(texture);
        drawBuffers.push(gl.COLOR_ATTACHMENT0 + i);
      }

      gl.drawBuffers(drawBuffers);

      let depthRenderbuffer = null;
      if (options.depth) {
        depthRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(GL_RB, depthRenderbuffer);
        gl.renderbufferStorage(GL_RB, gl.DEPTH_COMPONENT24, width, height);
        gl.framebufferRenderbuffer(GL_FB, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRenderbuffer);
        gl.bindRenderbuffer(GL_RB, null);
      }

      const status = gl.checkFramebufferStatus(GL_FB);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Framebuffer creation failed, status: ' + status);
      }

      gl.bindFramebuffer(GL_FB, null);
      gl.bindTexture(GL_TEX2D, null);

      const fb = {
        fbo, textures, targetCount, targetConfigs, width, height, useMipmap, depthRenderbuffer,

        get texture() { return textures[0]; },

        bind() {
          gl.bindFramebuffer(GL_FB, fbo);
          gl.viewport(0, 0, this.width, this.height);
          return this;
        },

        unbind() {
          gl.bindFramebuffer(GL_FB, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          return this;
        },

        clear(r = 0.0, g = 0.0, b = 0.0, a = 1.0) {
          this.bind();
          gl.clearColor(r, g, b, a);
          gl.clear(gl.COLOR_BUFFER_BIT | (depthRenderbuffer ? gl.DEPTH_BUFFER_BIT : 0));
          return this;
        },

        updateMipmap() {
          if (this.useMipmap) {
            for (const tex of textures) {
              gl.bindTexture(GL_TEX2D, tex);
              gl.generateMipmap(GL_TEX2D);
            }
            gl.bindTexture(GL_TEX2D, null);
          }
          return this;
        },

        updateTexture(xOffset, yOffset, width, height, data, updateMipmap = false) {
          gl.bindTexture(GL_TEX2D, textures[0]);
          gl.texSubImage2D(
            GL_TEX2D, 0,
            xOffset, yOffset, width, height,
            targetConfigs[0].format, targetConfigs[0].type, data
          );

          if (updateMipmap === true && this.useMipmap) {
            gl.generateMipmap(GL_TEX2D);
          }

          gl.bindTexture(GL_TEX2D, null);
          return this;
        },

        pass(shaderOrCallback, uniforms) {
          this.bind();
          runPass(shaderOrCallback, uniforms);
          if (this.useMipmap) this.updateMipmap();
          return this;
        },

        dispose() {
          gl.deleteFramebuffer(fbo);
          for (const tex of textures) {
            gl.deleteTexture(tex);
          }
          if (depthRenderbuffer) gl.deleteRenderbuffer(depthRenderbuffer);
          return this;
        },

        resize(newWidth, newHeight) {
          this.width = newWidth;
          this.height = newHeight;

          for (let i = 0; i < textures.length; i++) {
            const cfg = targetConfigs[i];
            gl.bindTexture(GL_TEX2D, textures[i]);
            gl.texImage2D(GL_TEX2D, 0, cfg.internalFormat, newWidth, newHeight, 0, cfg.format, cfg.type, null);
            if (this.useMipmap) gl.generateMipmap(GL_TEX2D);
          }
          gl.bindTexture(GL_TEX2D, null);

          if (depthRenderbuffer) {
            gl.bindRenderbuffer(GL_RB, depthRenderbuffer);
            gl.renderbufferStorage(GL_RB, gl.DEPTH_COMPONENT24, newWidth, newHeight);
            gl.bindRenderbuffer(GL_RB, null);
          }

          return this;
        }
      };

      resources.framebuffers.push(fb);
      return fb;
    },

    /**
     * Creates a ping-pong framebuffer pair for iterative effects
     * @param {number} width - Framebuffer width
     * @param {number} height - Framebuffer height
     * @param {Object} [options] - Same options as createFramebuffer
     * @returns {Object} Ping-pong framebuffer object
     */
    createPingPongFramebuffer(width, height, options = {}) {
      const fboA = this.createFramebuffer(width, height, null, options);
      const fboB = this.createFramebuffer(width, height, null, options);
      let isFirstRead = true;

      const ppfbo = {
        get read() { return isFirstRead ? fboA : fboB; },
        get write() { return isFirstRead ? fboB : fboA; },
        get texture() { return this.read.texture; },
        width, height,

        swap() {
          isFirstRead = !isFirstRead;
          return this;
        },

        pass(shader, uniforms) {
          this.write.pass(shader, uniforms);
          this.swap();
          return this;
        },

        clear(r = 0, g = 0, b = 0, a = 1) {
          fboA.clear(r, g, b, a);
          fboB.clear(r, g, b, a);
          return this;
        },

        resize(w, h) {
          this.width = w;
          this.height = h;
          fboA.resize(w, h);
          fboB.resize(w, h);
          return this;
        },

        dispose() {
          fboA.dispose();
          fboB.dispose();
          return this;
        }
      };

      return ppfbo;
    },

    /**
     * Creates a Uniform Buffer Object (UBO)
     */
    createUniformBuffer(blockName, bindingPoint, uniformData = null, usage = gl.DYNAMIC_DRAW) {
      let offset = 0;
      const layout = {};

      const typeInfo = {
        float: { size: 1, alignment: 1 },
        vec2: { size: 2, alignment: 2 },
        vec3: { size: 3, alignment: 4 },
        vec4: { size: 4, alignment: 4 }
      };

      for (const key in uniformData) {
        const { type } = uniformData[key];
        const info = typeInfo[type];
        if (!info) throw new Error(`Unsupported type: ${type}`);

        if (offset % info.alignment !== 0) {
          offset += info.alignment - (offset % info.alignment);
        }
        layout[key] = offset;
        offset += info.size;

        if (type === 'vec3') {
          offset = Math.ceil(offset / 4) * 4;
        }
      }

      let totalSize = offset;
      if (totalSize % 4 !== 0) {
        totalSize += (4 - (totalSize % 4));
      }

      const bufferData = new Float32Array(totalSize);
      for (const key in uniformData) {
        const { value } = uniformData[key];
        const start = layout[key];
        Array.isArray(value) ? bufferData.set(value, start) : bufferData[start] = value;
      }

      const ubo = gl.createBuffer();
      gl.bindBuffer(GL_UB, ubo);
      gl.bufferData(GL_UB, bufferData, usage);
      gl.bindBufferBase(GL_UB, bindingPoint, ubo);
      gl.bindBuffer(GL_UB, null);

      const uboObj = {
        ubo, bindingPoint, blockName, blockSize: totalSize, layout, data: bufferData,

        dispose() {
          gl.deleteBuffer(ubo);
          return this;
        },

        linkToShader(program) {
          const blockIndex = gl.getUniformBlockIndex(program, blockName);
          if (blockIndex !== gl.INVALID_INDEX) {
            gl.uniformBlockBinding(program, blockIndex, bindingPoint);
          } else {
            console.warn(`Uniform block "${blockName}" not found in shader program`);
          }
          return this;
        },

        update(newUniforms) {
          for (const key in newUniforms) {
            if (layout[key] === undefined) continue;
            const { value } = newUniforms[key];
            const start = layout[key];
            Array.isArray(value) ? bufferData.set(value, start) : bufferData[start] = value;
          }
          gl.bindBuffer(GL_UB, ubo);
          gl.bufferSubData(GL_UB, 0, bufferData);
          gl.bindBuffer(GL_UB, null);
        }
      };

      resources.ubos.push(uboObj);
      return uboObj;
    },

    /**
     * Render to the default framebuffer (screen)
     * @param {Function|Object} shaderOrCallback - Callback function, or shader object for shorthand
     * @param {Object} [uniforms] - Uniforms to set when using shader shorthand
     * @returns {Object} this
     */
    pass(shaderOrCallback, uniforms) {
      gl.bindFramebuffer(GL_FB, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      runPass(shaderOrCallback, uniforms);
      return this;
    },

    loadTexture(url, options = {}) {
      const opts = setDefaults(options, defaultTexOpts);

      const texture = gl.createTexture();
      gl.bindTexture(GL_TEX2D, texture);

      gl.texImage2D(GL_TEX2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));

      setTexParams(opts);

      const image = new Image();
      image.onload = () => {
        gl.bindTexture(GL_TEX2D, texture);
        gl.texImage2D(
          GL_TEX2D, 0, opts.internalFormat, opts.format,
          opts.type, image
        );

        if (options.generateMipmap !== false) {
          gl.generateMipmap(GL_TEX2D);
        }

        gl.bindTexture(GL_TEX2D, null);
      };

      image.onerror = () => console.error(`Failed to load texture from ${url}`);
      image.src = url;

      gl.bindTexture(GL_TEX2D, null);
      resources.textures.push(texture);
      return texture;
    },

    /**
     * Start an animation loop
     * @param {Function} callback - Called each frame with (time, deltaTime) in seconds
     * @returns {Object} this
     */
    loop(callback) {
      loopCallback = callback;
      lastTime = 0;

      const animate = (timestamp) => {
        const time = timestamp * 0.001; // Convert to seconds
        const deltaTime = lastTime ? time - lastTime : 0;
        lastTime = time;

        loopCallback(time, deltaTime);
        loopId = requestAnimationFrame(animate);
      };

      loopId = requestAnimationFrame(animate);
      return this;
    },

    /**
     * Stop the animation loop
     * @returns {Object} this
     */
    stopLoop() {
      if (loopId !== null) {
        cancelAnimationFrame(loopId);
        loopId = null;
        loopCallback = null;
        lastTime = 0;
      }
      return this;
    },

    /**
     * Dispose all resources and clean up the framework
     */
    dispose() {
      this.stopLoop();
      for (const shader of resources.shaders) shader.dispose();
      for (const fb of resources.framebuffers) fb.dispose();
      for (const tf of resources.transformFeedbacks) tf.dispose();
      for (const ubo of resources.ubos) ubo.dispose();
      for (const tex of resources.textures) gl.deleteTexture(tex);
      resources.shaders.length = 0;
      resources.framebuffers.length = 0;
      resources.transformFeedbacks.length = 0;
      resources.ubos.length = 0;
      resources.textures.length = 0;
      gl.deleteBuffer(quadBuffer);
      gl.deleteVertexArray(quadVAO);
      for (const key in activeTextures) delete activeTextures[key];
      textureUnit = 0;
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }

      return this;
    }
  };

  return framework;
}
