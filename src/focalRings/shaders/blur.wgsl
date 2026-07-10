struct BlurParams {
  direction: vec2f,
  texelSize: vec2f,
};

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlurParams;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let step = params.direction * params.texelSize;
  var result = textureSample(inputTex, samp, uv).rgb * 0.227027;
  var off = step;
  result += (textureSample(inputTex, samp, uv + off).rgb + textureSample(inputTex, samp, uv - off).rgb) * 0.1945946;
  off = step * 2.0;
  result += (textureSample(inputTex, samp, uv + off).rgb + textureSample(inputTex, samp, uv - off).rgb) * 0.1216216;
  off = step * 3.0;
  result += (textureSample(inputTex, samp, uv + off).rgb + textureSample(inputTex, samp, uv - off).rgb) * 0.054054;
  off = step * 4.0;
  result += (textureSample(inputTex, samp, uv + off).rgb + textureSample(inputTex, samp, uv - off).rgb) * 0.016216;
  return vec4f(result, 1.0);
}
