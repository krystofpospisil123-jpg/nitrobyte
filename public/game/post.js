// Post-processing for the "street racing at night" look: bloom on every neon / lamp / window, radial speed blur,
// chromatic aberration, colour grade (cool shadows, warm highlights), vignette and a little film grain.
// An adaptive quality governor lowers the render scale / drops bloom when the machine cannot keep 40+ fps.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const StreetShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlur: { value: 0 },        // 0..1 radial speed blur
    uAberr: { value: 0 },       // extra chromatic aberration (turbo / hits)
    uGrade: { value: 1 },       // strength of the colour grade
    uVig: { value: 0.35 },      // vignette strength
    uGrain: { value: 0.01 },
    uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uBlur, uAberr, uGrade, uVig, uGrain, uTime;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      float ab = (0.0005 + uAberr) * r;                       // channels split a little toward the edges
      vec3 col;
      if (uBlur > 0.004) {
        vec2 off = c * uBlur * 0.22 * smoothstep(0.05, 0.5, r) ;
        col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float k = float(i) / 7.0;
          vec2 uv = vUv - off * k;
          col += vec3(texture2D(tDiffuse, uv + c * ab).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ab).b);
        }
        col /= 8.0;
      } else {
        col = vec3(texture2D(tDiffuse, vUv + c * ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ab).b);
      }
      // colour grade: richer colours, more contrast, cool shadows / warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.0 + 0.22 * uGrade);
      col = (col - 0.12) * (1.0 + 0.10 * uGrade) + 0.12;
      col *= mix(vec3(0.93, 0.98, 1.10), vec3(1.08, 1.0, 0.93), smoothstep(0.05, 0.8, l));
      col *= mix(1.0, smoothstep(0.95, 0.30, r * (1.0 + uVig)), 0.65);
      col += (fract(sin(dot(vUv * vec2(1731.0, 1013.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(1);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.35, 0.85);
    this.composer.addPass(this.bloom);
    this.street = new ShaderPass(StreetShader);
    this.composer.addPass(this.street);
    this.composer.addPass(new OutputPass());
    this.u = this.street.uniforms;
    this.bloomStrength = 0.8;
    this.level = 0;                        // 0 = full quality ... 3 = plain rendering
    this.enabled = true;
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  /** Per-theme look: bloom strength / threshold, grade and vignette. */
  setLook({ bloom = 0.8, threshold = 0.62, grade = 1, vignette = 0.35 } = {}) {
    this.bloomStrength = bloom; this.bloom.threshold = threshold;
    this.u.uGrade.value = grade; this.u.uVig.value = vignette;
  }

  /** speed01: 0..1 of top speed, boost: 0..1 turbo / pad boost, hit: 0..1 wall hit flash. */
  render(timeSec, speed01 = 0, boost = 0, hit = 0) {
    const u = this.u;
    u.uBlur.value = this.level >= 2 ? 0 : Math.max(0, speed01 - 0.6) * 0.45 + boost * 0.22;
    u.uAberr.value = boost * 0.004 + hit * 0.012;
    u.uTime.value = timeSec % 10;
    this.bloom.enabled = this.level < 1 && this.bloomStrength > 0;
    this.bloom.strength = this.bloomStrength * (1 + boost * 0.15);
    if (this.level >= 3) this.renderer.render(this._scene || this.composer.passes[0].scene, this.composer.passes[0].camera);
    else this.composer.render();
  }
}
