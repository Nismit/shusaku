struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
  kick: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
};

// Matches KICK_DECAY in main.js: kick == exp(-KICK_DECAY * elapsed), so
// (1 - kick) / KICK_DECAY is the closed-form integral of kick over elapsed
// time, i.e. the extra angle a speed*ROT_BOOST rad/s velocity spike would
// have added by now. Its derivative is speed*ROT_BOOST*kick, which is
// speed*ROT_BOOST at the moment of the click and eases back to 0 - a
// smooth accelerate-then-settle with no discontinuity in angle or velocity.
const KICK_DECAY: f32 = 2.5;
const ROT_BOOST: f32 = 3.0;

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) speed: f32) -> VOut {
  let kickIntegral = (1.0 - u.kick) / KICK_DECAY;
  let angle = u.time * speed + speed * ROT_BOOST * kickIntegral;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec3f(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
  var out: VOut;
  out.position = u.viewProj * vec4f(rotated, 1.0);
  out.alpha = alpha;
  return out;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, v.alpha);
}
