/**
 * Shadow mapping helper for particle systems (WebGPU).
 * 行列は列優先 (column-major) で WGSL mat4x4<f32> にそのまま渡せる。
 * ortho は WebGPU 規約 (NDC z = 0..1) で出力する点が WebGL 版との違い。
 */

function lookAt(eye, center, up) {
  const out = new Float32Array(16);

  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  zx /= len; zy /= len; zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  xx /= len; xy /= len; xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[4] = xy; out[8]  = xz; out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[1] = yx; out[5] = yy; out[9]  = yz; out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[2] = zx; out[6] = zy; out[10] = zz; out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[3] = 0;  out[7] = 0;  out[11] = 0;  out[15] = 1;
  return out;
}

// WebGPU 規約: NDC z を [0, 1] にマップ (WebGL 版は [-1, 1])
function ortho(left, right, bottom, top, near, far) {
  const out = new Float32Array(16);
  out.fill(0);
  const rl = right - left;
  const tb = top - bottom;
  const fn = far - near;
  out[0]  =  2 / rl;
  out[5]  =  2 / tb;
  out[10] = -1 / fn;
  out[12] = -(right + left) / rl;
  out[13] = -(top + bottom) / tb;
  out[14] = -near / fn;
  out[15] = 1;
  return out;
}

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[j * 4 + i] =
        a[i] * b[j * 4] +
        a[4 + i] * b[j * 4 + 1] +
        a[8 + i] * b[j * 4 + 2] +
        a[12 + i] * b[j * 4 + 3];
    }
  }
  return out;
}

export function buildLightMatrices(lightDir, extent) {
  const lx = lightDir[0], ly = lightDir[1], lz = lightDir[2];
  const len = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const nx = lx / len, ny = ly / len, nz = lz / len;

  const dist = extent * 3.0;
  const eye = [nx * dist, ny * dist, nz * dist];
  const center = [0, 0, 0];

  const upCandidate = Math.abs(ny) < 0.99 ? [0, 1, 0] : [1, 0, 0];

  const view = lookAt(eye, center, upCandidate);
  const proj = ortho(-extent, extent, -extent, extent, 0.01, dist * 2.0);
  const viewProj = mat4Mul(proj, view);

  return viewProj;
}
