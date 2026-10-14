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

const POST_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FRAG = `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uDamage;
uniform float uLowHp;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uTime;
uniform float uDither;
uniform float uAlert;
uniform float uSlowmo;
varying vec2 vUv;

float bayer4(vec2 p){
  int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  for (int k=0;k<16;k++){ if(k==i) return m[k]/16.0; }
  return 0.0;
}

void main(){
  vec2 uv = vUv;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  // exposure + soft gamma lift (scene is lit in linear space, displayed without full sRGB)
  c = pow(c * 1.3, vec3(0.78));
  vec2 q = uv - 0.5;
  float r2 = dot(q, q);
  // vignette
  c *= 1.0 - r2 * 0.9;
  // slow-mo desaturate
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(lum) * vec3(0.9, 1.0, 1.15), uSlowmo * 0.6);
  // low health pulse: desaturate edges + red
  float edge = smoothstep(0.08, 0.32, r2);
  c = mix(c, vec3(lum * 1.1, lum * 0.25, lum * 0.25), uLowHp * edge * (0.55 + 0.25 * sin(uTime * 6.0)));
  // damage flash at the screen edges
  c = mix(c, vec3(0.9, 0.05, 0.08), clamp(uDamage, 0.0, 1.0) * edge * 0.85);
  // alert red wash (very subtle)
  c += vec3(0.05, 0.0, 0.0) * uAlert * edge;
  // fullscreen flash
  c = mix(c, uFlashColor, clamp(uFlash, 0.0, 1.0));
  // colour quantisation with ordered dither (PS1-style 15-bit-ish colour)
  if (uDither > 0.0) {
    float d = bayer4(gl_FragCoord.xy / max(1.0, uRes.y / 240.0)) - 0.5;
    float levels = 40.0;
    c = floor(c * levels + d * uDither + 0.5) / levels;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

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
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      type: THREE.UnsignedByteType,
    });
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uDamage: { value: 0 },
        uLowHp: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uTime: { value: 0 },
        uDither: { value: 1 },
        uAlert: { value: 0 },
        uSlowmo: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.width = 1; this.height = 1;
    this.internalW = 1; this.internalH = 1;
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w; this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.r.setSize(Math.floor(w * dpr), Math.floor(h * dpr), false);
    this.r.domElement.style.width = w + 'px';
    this.r.domElement.style.height = h + 'px';
    let ih = this.settings.get('resolution');
    ih = Math.min(ih, Math.floor(h * dpr));
    const iw = Math.max(1, Math.round(ih * (w / h)));
    this.internalW = iw; this.internalH = ih;
    this.rt.setSize(iw, ih);
    this.postMat.uniforms.uRes.value.set(Math.floor(w * dpr), Math.floor(h * dpr));
    const jitter = this.settings.get('jitter');
    psxUniforms.uSnap.value.set(jitter ? Math.round(ih * (w / h) * 0.5) : 0, jitter ? Math.round(ih * 0.5) : 0);
  }

  render(scene, camera, vmScene, vmCamera) {
    const r = this.r;
    r.setRenderTarget(this.rt);
    r.setClearColor(scene.fog ? scene.fog.color : 0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (vmScene) {
      r.clearDepth();
      r.render(vmScene, vmCamera);
    }
    r.setRenderTarget(null);
    r.clear(true, true, false);
    r.render(this.postScene, this.postCam);
  }
}
