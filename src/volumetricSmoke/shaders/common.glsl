// Shared helpers for the flat-3D (tiled 2D atlas) volume representation.
// A WxHxD volume is stored as a 2D texture: D slices laid out in a
// uTiles.x by uTiles.y grid. esChottoGL injects the version header, the
// float precision, the vTexCoord varying and the fragColor output, so this
// file must declare none of them (and must not mention them literally,
// since the framework detects existing declarations by text match).

uniform vec3 uVolumeDim;   // (W, H, D) in cells
uniform vec2 uTiles;       // (cols, rows) of slice tiles in the atlas
uniform vec2 uInvAtlasSize; // 1.0 / (atlas width, atlas height) in pixels

// Integer cell (cx, cy, cz) -> atlas UV at the texel center (NEAREST-safe).
vec2 cellToUV(vec3 cell) {
    cell = clamp(cell, vec3(0.0), uVolumeDim - 1.0);
    float slice = cell.z;
    float tx = mod(slice, uTiles.x);
    float ty = floor(slice / uTiles.x);
    vec2 pixel = vec2(tx * uVolumeDim.x + cell.x,
                      ty * uVolumeDim.y + cell.y) + 0.5;
    return pixel * uInvAtlasSize;
}

// Single nearest tap at an integer-rounded cell position.
vec4 sampleNearest(sampler2D vol, vec3 p) {
    return texture(vol, cellToUV(floor(p + 0.5)));
}

// Trilinear sample at a continuous cell-space position p in [0, dim-1].
vec4 sampleVolume(sampler2D vol, vec3 p) {
    p = clamp(p, vec3(0.0), uVolumeDim - 1.0);
    vec3 b = floor(p);
    vec3 f = p - b;

    vec4 c000 = texture(vol, cellToUV(b + vec3(0.0, 0.0, 0.0)));
    vec4 c100 = texture(vol, cellToUV(b + vec3(1.0, 0.0, 0.0)));
    vec4 c010 = texture(vol, cellToUV(b + vec3(0.0, 1.0, 0.0)));
    vec4 c110 = texture(vol, cellToUV(b + vec3(1.0, 1.0, 0.0)));
    vec4 c001 = texture(vol, cellToUV(b + vec3(0.0, 0.0, 1.0)));
    vec4 c101 = texture(vol, cellToUV(b + vec3(1.0, 0.0, 1.0)));
    vec4 c011 = texture(vol, cellToUV(b + vec3(0.0, 1.0, 1.0)));
    vec4 c111 = texture(vol, cellToUV(b + vec3(1.0, 1.0, 1.0)));

    vec4 x00 = mix(c000, c100, f.x);
    vec4 x10 = mix(c010, c110, f.x);
    vec4 x01 = mix(c001, c101, f.x);
    vec4 x11 = mix(c011, c111, f.x);
    vec4 y0 = mix(x00, x10, f.y);
    vec4 y1 = mix(x01, x11, f.y);
    return mix(y0, y1, f.z);
}

// Recover the integer cell coordinate of the fragment currently being shaded
// from its atlas texture coordinate.
vec3 fragCell() {
    vec2 atlasPixel = vTexCoord / uInvAtlasSize;     // pixel coords in atlas
    vec2 within = mod(atlasPixel, uVolumeDim.xy);    // pixel within slice tile
    float tileX = floor(atlasPixel.x / uVolumeDim.x);
    float tileY = floor(atlasPixel.y / uVolumeDim.y);
    float z = tileY * uTiles.x + tileX;
    return vec3(floor(within), z);
}

// True when the cell is on the 1-cell border wall of the volume.
bool isBoundary(vec3 cell) {
    return any(lessThan(cell, vec3(0.5))) ||
           any(greaterThan(cell, uVolumeDim - 1.5));
}
