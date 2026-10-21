import * as THREE from 'three';

// Global uniforms shared by every "PSX" material (vertex snapping for the retro wobble).
export const psxUniforms = {
  uSnap: { value: new THREE.Vector2(240, 180) },
};

export function psxify(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = psxUniforms.uSnap;
    sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      if (uSnap.x > 0.0 && gl_Position.w > 0.0) {
        vec2 sp = gl_Position.xy / gl_Position.w;
        sp = floor(sp * uSnap + 0.5) / uSnap;
        gl_Position.xy = sp * gl_Position.w;
      }`
    );
  };
  mat.customProgramCacheKey = () => 'psx1';
  return mat;
}

// Pipeline (all fullscreen passes share one quad):
//   scene + viewmodel -> rt (low-res, nearest)
//   rt -> bloomA (1/4 res, bright pass) -> bloomB (blur x) -> bloomA (blur y)
//   rt + bloomA -> postRT (low-res composite: grade, glow, vignette, grain, dither) = postMat
//   postRT -> screen (nearest upscale, optional CRT scanlines)
// Grading and dithering run at the internal resolution, so the dither grid matches the chunky
// pixels and the device-resolution pass is a trivial blit (cheaper on phones than before).

const FS_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// 4 bilinear taps cover the 4x4 block under each bloom texel. Saturated colours (emissive accents,
// muzzle flashes, eyes) pass the threshold sooner than bright lit grey walls.
const BRIGHT_FRAG = `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThresh;
varying vec2 vUv;
vec3 pick(vec2 uv){
  vec3 c = texture2D(tSrc, uv).rgb;
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float k = hi * 0.8 + (hi - lo) * 0.6;
  return c * smoothstep(uThresh, uThresh + 0.28, k);
}
void main(){
  vec2 o = uTexel;
  vec3 c = pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y));
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

// 9-tap gaussian from 5 bilinear taps
const BLUR_FRAG = `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
  vec2 o1 = uDir * 1.3846154, o2 = uDir * 3.2307692;
  c += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162;
  c += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const POST_FRAG = `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uDamage;
uniform float uLowHp;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uTime;
uniform float uDither;
uniform float uAlert;
uniform float uSlowmo;
uniform float uRush;
uniform float uScope;
uniform float uBloom;
uniform float uGrain;
uniform float uAspect;
uniform vec3 uFog;
uniform vec3 uHigh;
uniform float uSat;
uniform float uContrast;
uniform float uLift;
varying vec2 vUv;

// ordered 4x4 Bayer threshold in [0,1) without a lookup table
float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
// soft shoulder above 0.8 so brightly lit walls keep some gradation instead of clipping flat
vec3 shoulder(vec3 x){ return min(x, 0.8) + 0.2 * (1.0 - exp(-max(x - 0.8, 0.0) * 5.0)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main(){
  vec2 uv = vUv;
  vec2 q = uv - 0.5;
  float r2 = dot(q, q);
  // chromatic aberration only while hurt, and a touch at the scope's lens rim
  vec2 sq = vec2(q.x * uAspect, q.y);
  float lensR = 0.36 + 0.08 * uScope;
  float rim = uScope * smoothstep(lensR * 0.55, lensR, length(sq));
  float ca = clamp(uDamage, 0.0, 1.0) * 0.022 + rim * 0.018;
  vec3 c;
  if (ca > 0.0004) {
    vec2 off = q * ca * (0.4 + r2 * 3.0);
    c = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
  } else {
    c = texture2D(tDiffuse, uv).rgb;
  }
  // glow from emissive accents, lamps, muzzle flashes and explosions
  if (uBloom > 0.0) c += texture2D(tBloom, uv).rgb * uBloom;
  // exposure + soft gamma lift (scene is lit in linear space, displayed without full sRGB)
  c = shoulder(pow(c * 1.3, vec3(0.78)));
  // atmosphere: shadows pick up the stratum's fog hue, highlights its lamp colour
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 fogHue = uFog / max(0.02, max(uFog.r, max(uFog.g, uFog.b)));
  c += fogHue * uLift * (1.0 - smoothstep(0.0, 0.45, lum));
  c *= mix(vec3(1.0), uHigh, smoothstep(0.3, 1.0, lum) * 0.3);
  lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = max(mix(vec3(lum), c, uSat), 0.0);
  vec3 cc = clamp(c, 0.0, 1.0);
  c = mix(c, cc * cc * (3.0 - 2.0 * cc), uContrast);
  // vignette (a little stronger through the scope's lens, with a cool glass tint)
  c *= 1.0 - r2 * (0.85 + 0.6 * uScope);
  c = mix(c, c * vec3(0.9, 1.02, 1.08), uScope * 0.5);
  // slow-mo desaturate
  lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(lum) * vec3(0.9, 1.0, 1.15), uSlowmo * 0.6);
  // low health pulse: desaturate edges + red
  float edge = smoothstep(0.08, 0.32, r2);
  c = mix(c, c * vec3(1.12, 0.92, 1.1), uRush * 0.5);
  c += vec3(0.30, 0.02, 0.26) * uRush * edge * (0.7 + 0.3 * sin(uTime * 14.0));
  c = mix(c, vec3(lum * 1.1, lum * 0.25, lum * 0.25), uLowHp * edge * (0.55 + 0.25 * sin(uTime * 6.0)));
  // damage flash at the screen edges
  c = mix(c, vec3(0.9, 0.05, 0.08), clamp(uDamage, 0.0, 1.0) * edge * 0.85);
  // alert red wash (very subtle)
  c += vec3(0.05, 0.0, 0.0) * uAlert * edge;
  // fullscreen flash
  c = mix(c, uFlashColor, clamp(uFlash, 0.0, 1.0));
  // film grain at the chunky pixel scale, 24 fps, mostly in the mid-tones
  if (uGrain > 0.0) {
    float n = hash12(gl_FragCoord.xy + floor(uTime * 24.0) * vec2(17.0, 59.0)) - 0.5;
    c += n * uGrain * (0.5 + lum * (1.0 - lum) * 2.0);
  }
  // colour quantisation with ordered dither (PS1-style 15-bit colour: 32 levels per channel)
  if (uDither > 0.0) {
    float d = bayer4(gl_FragCoord.xy) - 0.5;
    c = floor(c * 31.0 + d * uDither + 0.5) / 31.0;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

// Nearest upscale to the device resolution. Optional CRT: soft scanlines between the chunky rows
// plus a faint aperture grille (only when there are enough device pixels per row to draw them).
const BLIT_FRAG = `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uIn;
uniform vec2 uOut;
uniform float uCrt;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  if (uCrt > 0.0) {
    float ratio = uOut.y / uIn.y;
    float k = uCrt * clamp(ratio - 1.4, 0.0, 1.0);
    float f = fract(vUv.y * uIn.y);
    float s = 0.5 + 0.5 * cos((f - 0.5) * 6.2831853);
    c *= mix(1.0, 0.62 + 0.5 * s, k);
    float m = mod(floor(gl_FragCoord.x), 3.0);
    vec3 mask = vec3(m == 0.0 ? 1.06 : 0.92, m == 1.0 ? 1.06 : 0.92, m == 2.0 ? 1.06 : 0.92);
    c *= mix(vec3(1.0), mask, k * 0.6);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

// Neutral grade (used until a stratum sets its own through setTheme)
const DEFAULT_GRADE = { hi: 0xfff4e8, sat: 1.08, contrast: 0.18, lift: 0.05, bloom: 0.85, thresh: 0.62, grain: 0.035 };

const lowPowerDevice = () => {
  try {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && coarse;
  } catch { return false; }
};

export class Renderer {
  constructor(canvas, settings) {
    this.settings = settings;
    THREE.ColorManagement.enabled = false;
    this.r = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.r.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.r.setPixelRatio(1);
    this.r.autoClear = false;
    // phones/tablets: a coarser glow buffer (the passes are tiny either way)
    this.lowPower = lowPowerDevice();
    const target = (filter, depth) => new THREE.WebGLRenderTarget(4, 4, {
      minFilter: filter, magFilter: filter, depthBuffer: depth, stencilBuffer: false,
      type: THREE.UnsignedByteType, generateMipmaps: false,
    });
    // linear minification so the bright pass averages every source pixel; 1:1 and upscales stay nearest
    this.rt = target(THREE.NearestFilter, true);
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.postRT = target(THREE.NearestFilter, false);
    this.bloomA = target(THREE.LinearFilter, false);
    this.bloomB = target(THREE.LinearFilter, false);
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pass = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms });
    this.brightMat = pass(BRIGHT_FRAG, {
      tSrc: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2(1, 1) }, uThresh: { value: DEFAULT_GRADE.thresh },
    });
    this.blurX = pass(BLUR_FRAG, { tSrc: { value: this.bloomA.texture }, uDir: { value: new THREE.Vector2(1, 0) } });
    this.blurY = pass(BLUR_FRAG, { tSrc: { value: this.bloomB.texture }, uDir: { value: new THREE.Vector2(0, 1) } });
    this.postMat = pass(POST_FRAG, {
      tDiffuse: { value: this.rt.texture },
      tBloom: { value: this.bloomA.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDamage: { value: 0 },
      uLowHp: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uTime: { value: 0 },
      uDither: { value: 1 },
      uAlert: { value: 0 },
      uSlowmo: { value: 0 },
      uRush: { value: 0 },
      uScope: { value: 0 },
      uBloom: { value: DEFAULT_GRADE.bloom },
      uGrain: { value: DEFAULT_GRADE.grain },
      uAspect: { value: 1 },
      uFog: { value: new THREE.Color(0x0a0a14) },
      uHigh: { value: new THREE.Color(DEFAULT_GRADE.hi) },
      uSat: { value: DEFAULT_GRADE.sat },
      uContrast: { value: DEFAULT_GRADE.contrast },
      uLift: { value: DEFAULT_GRADE.lift },
    });
    this.blitMat = pass(BLIT_FRAG, {
      tSrc: { value: this.postRT.texture }, uIn: { value: new THREE.Vector2(1, 1) }, uOut: { value: new THREE.Vector2(1, 1) }, uCrt: { value: 0 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
    this.grade = DEFAULT_GRADE;
    this.theme = null;
    this.width = 1; this.height = 1;
    this.internalW = 1; this.internalH = 1;
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w; this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ow = Math.floor(w * dpr), oh = Math.floor(h * dpr);
    this.r.setSize(ow, oh, false);
    this.r.domElement.style.width = w + 'px';
    this.r.domElement.style.height = h + 'px';
    let ih = this.settings.get('resolution');
    ih = Math.min(ih, oh);
    const iw = Math.max(1, Math.round(ih * (w / h)));
    this.internalW = iw; this.internalH = ih;
    this.rt.setSize(iw, ih);
    this.postRT.setSize(iw, ih);
    const div = this.lowPower ? 6 : 4;
    const bw = Math.max(1, Math.ceil(iw / div)), bh = Math.max(1, Math.ceil(ih / div));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    // bright-pass taps sit on texel corners around the centre of the block under each bloom texel
    this.brightMat.uniforms.uTexel.value.set(1 / iw, 1 / ih);
    this.blurX.uniforms.uDir.value.set(1 / bw, 0);
    this.blurY.uniforms.uDir.value.set(0, 1 / bh);
    const u = this.postMat.uniforms;
    u.uRes.value.set(iw, ih);
    u.uAspect.value = w / h;
    this.blitMat.uniforms.uIn.value.set(iw, ih);
    this.blitMat.uniforms.uOut.value.set(ow, oh);
    const jitter = this.settings.get('jitter');
    psxUniforms.uSnap.value.set(jitter ? Math.round(ih * (w / h) * 0.5) : 0, jitter ? Math.round(ih * 0.5) : 0);
  }

  /**
   * Per-stratum colour grade (theme.grade: hi, sat, contrast, lift, bloom, thresh, grain). Cheap to
   * call every frame: it only touches uniforms when the theme or room changes.
   */
  setTheme(theme, room = null) {
    if (theme === this.theme && room === this.room) return;
    this.theme = theme; this.room = room;
    const gr = { ...DEFAULT_GRADE, ...((theme && theme.grade) || {}) };
    // the final boss hall is stark white light; open rooftops read a little cleaner
    if (room && room.spec && room.spec.bossType === 'architect') { gr.sat *= 0.85; gr.contrast += 0.08; gr.bloom *= 1.2; }
    if (room && room.spec && room.spec.open) gr.lift *= 0.6;
    this.grade = gr;
    const u = this.postMat.uniforms;
    u.uHigh.value.setHex(gr.hi);
    u.uSat.value = gr.sat;
    u.uContrast.value = gr.contrast;
    u.uLift.value = gr.lift;
    u.uGrain.value = gr.grain;
    this.brightMat.uniforms.uThresh.value = gr.thresh;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.postScene, this.postCam);
  }

  render(scene, camera, vmScene, vmCamera) {
    const r = this.r;
    const s = this.settings;
    r.setRenderTarget(this.rt);
    r.setClearColor(scene.fog ? scene.fog.color : 0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (vmScene) {
      r.clearDepth();
      r.render(vmScene, vmCamera);
    }
    const u = this.postMat.uniforms;
    if (scene.fog) u.uFog.value.copy(scene.fog.color);
    // glow: on unless the player turns it off (settings key 'bloom'); dimmer with reduced flashes
    const bloom = s.get('bloom') !== false;
    u.uBloom.value = bloom ? this.grade.bloom * (s.get('reduceFlashes') ? 0.6 : 1) : 0;
    if (bloom) {
      this.pass(this.brightMat, this.bloomA);
      this.pass(this.blurX, this.bloomB);
      this.pass(this.blurY, this.bloomA);
    }
    this.pass(this.postMat, this.postRT);
    this.blitMat.uniforms.uCrt.value = s.get('crt') ? 1 : 0;
    this.pass(this.blitMat, null);
  }
}
