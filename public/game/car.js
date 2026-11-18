// Car: arcade physics + low-poly mesh. All numbers come from CONFIG.car.
// Convention: heading h, forward = (sin h, cos h) in the XZ plane. Steering right DEcreases h.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { skinTexture } from './skins.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Light textures (shared): a soft round glow, and a headlight pool that fades with distance from the car
let _glowTex = null, _beamTex = null;
function glowTex() {
  if (_glowTex) return _glowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_glowTex = new THREE.CanvasTexture(cv));
}
function beamTex() {
  if (_beamTex) return _beamTex;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d');
  for (let y = 0; y < 128; y++) {                                  // top of the picture = right in front of the bumper
    const f = y / 127, a = Math.pow(1 - f, 1.6), half = 10 + 22 * f;      // the pool widens with distance
    const gr = g.createLinearGradient(32 - half, 0, 32 + half, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, y, 64, 1);
  }
  return (_beamTex = new THREE.CanvasTexture(cv));
}
const additive = (color, map, opacity = 1) => new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

export class Car {
  static night = false;            // night themes: headlight pools on the road
  /** Default look for bots / extra players: plain paint in `cssColor`, wing style from `style`. */
  static defaultLook(cssColor, style = 0) {
    return { color: parseInt(String(cssColor).replace('#', ''), 16), body: 'coupe', skin: 'none', wing: style % 2, rims: 0xc8ccd8, glow: null, flame: 0xffa21a };
  }

  /** look: { color, skin, wing, rims, glow, flame } - see catalog.js / profile.lookOf() */
  constructor(look) {
    this.x = 0; this.z = 0; this.heading = 0;
    this.vx = 0; this.vz = 0;       // world velocity
    this.steer = 0;                 // smoothed steering actually applied (-1..1)
    this.speed = 0;                 // forward speed (m/s, negative = reversing)
    this.drifting = false;
    this.turboMeter = 0;            // 0..1, filled by drifting
    this.turboTime = 0;             // seconds of turbo left
    this._turboHeld = false;        // for edge detection of the turbo button
    this.speedScale = 1;            // bots use this for rubber-banding (1 = normal)
    this.perk = { speed: 1, accel: 1, turbo: 1 };   // garage upgrades (multipliers)
    this.base = 0;                  // ground height under the car (set from the track each frame)
    this.groundSlope = 0;           // road grade along the car's heading (+ = uphill)
    this.pitch = 0;                 // smoothed visual pitch
    this.stun = 0;                  // > 0 after a hard hit: the car slides with little grip
    this.spin = 0;                  // yaw rate from a hit (rad/s), dies away
    // vertical motion (ramps)
    this.y = 0; this.vy = 0;
    this.airborne = false; this.airTime = 0;
    this.onRamp = false; this.rampSlope = 0;
    this.landed = 0;                // set to the air time on the frame the car lands (for dust effects)
    this.hitWall = false;           // set by the driver when the car touches a barrier
    this.look = look;
    this.mesh = Car.buildMesh(look);
  }

  /** Swap the 3D model for a new look (garage, new race). Keeps the mesh in the same scene. */
  setLook(look) {
    const parent = this.mesh.parent;
    if (parent) parent.remove(this.mesh);
    this.look = look;
    this.mesh = Car.buildMesh(look);
    if (parent) parent.add(this.mesh);
    this.syncMesh();
  }

  /** Start a boost without spending the meter (boost pads, rocket start). */
  boost(seconds) { this.turboTime = Math.max(this.turboTime, seconds); }

  place(x, z, heading, base = 0) {
    this.x = x; this.z = z; this.heading = heading; this.base = base; this.groundSlope = 0; this.pitch = 0;
    this.vx = this.vz = 0; this.speed = 0;
    this.y = 0; this.vy = 0; this.airborne = false; this.onRamp = false; this.airTime = 0;
    this.turboTime = 0; this.turboMeter = 0; this.drifting = false; this.steer = 0; this._turboHeld = false;
    this.syncMesh();
  }

  /**
   * Advance physics by dt seconds.
   * input: { steer -1..1, throttle 0..1, brake 0..1, drift, turbo }   surface: { offroad: bool, ramp: {h, slope} | null }
   */
  /** Knocked by another car: extra velocity (m/s), a spin and, for a big hit, a little hop. */
  bump(dvx, dvz, strength) {
    this.vx += dvx; this.vz += dvz;
    if (strength < 4) return;
    this.stun = Math.max(this.stun, CONFIG.race.bumpStun * Math.min(1.5, strength / 12));
    this.spin += (Math.random() < 0.5 ? -1 : 1) * Math.min(5, strength * 0.22);
    if (strength > 11 && !this.airborne) { this.airborne = true; this.airTime = 0; this.vy = Math.min(6, strength * 0.25); this.y = Math.max(this.y, 0.05); }
  }

  update(dt, input, surface) {
    const C = CONFIG.car;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading); // left axis

    // split velocity into forward / sideways parts
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;

    const D = CONFIG.drift, T = CONFIG.turbo, R = CONFIG.ramp;
    this.landed = 0;
    this.throttle = input.throttle; this.brake = input.brake;     // remembered for the engine sound

    // --- vertical motion: ramp surface, takeoff, flight, landing ---
    const ramp = surface.ramp;
    if (ramp && this.y <= ramp.h + 0.05 && this.vy <= 0) {          // driving on a ramp
      this.y = ramp.h; this.vy = 0; this.onRamp = true; this.airborne = false; this.rampSlope = ramp.slope;
    } else if (this.onRamp && !ramp) {                              // just left the ramp -> take off
      this.onRamp = false;
      if (vf > 5 && this.rampSlope > 0) {
        this.airborne = true; this.airTime = 0;
        this.vy = this.rampSlope * vf * R.launch + R.pop;
      } else this.y = 0;
    }
    if (this.airborne) {
      this.y += this.vy * dt; this.vy -= R.gravity * dt; this.airTime += dt;
      if (this.y <= 0) {                                            // landing
        this.landed = this.airTime;
        this.y = 0; this.vy = 0; this.airborne = false;
        this.turboMeter = Math.min(1, this.turboMeter + this.airTime * R.airCharge);  // reward for air time
      }
    }
    const air = this.airborne;

    // --- turbo: activates on button press (edge) when the meter is charged enough ---
    if (input.turbo && !this._turboHeld && this.turboTime <= 0 && this.turboMeter >= T.minCharge) {
      this.turboTime = T.duration * (0.4 + 0.6 * this.turboMeter);
      this.turboMeter = 0;
    }
    this._turboHeld = !!input.turbo;
    const boosting = this.turboTime > 0;
    if (boosting) this.turboTime -= dt;
    const maxSpeed = (C.maxSpeed + (boosting ? T.speedBonus : 0)) * this.speedScale * this.perk.speed;
    const accel = (C.acceleration + (boosting ? T.accelBonus : 0)) * this.speedScale * this.perk.accel;

    // --- drift: hold button while steering at speed ---
    if (air) this.drifting = false;
    if (!air && !this.drifting && input.drift && Math.abs(input.steer) > 0.3 && vf > D.minSpeed) this.drifting = true;
    if (this.drifting && (!input.drift || vf < D.minSpeed * 0.6)) this.drifting = false;
    if (this.drifting && Math.abs(this.steer) > D.minSteer) {
      this.turboMeter = Math.min(1, this.turboMeter + D.turboChargeRate * this.perk.turbo * dt);
    }

    // --- throttle / brake ---
    if (!air && (input.throttle > 0 || boosting) && vf < maxSpeed) vf += accel * (boosting ? 1 : input.throttle) * dt;
    if (!air && input.brake > 0 && !boosting) {
      if (vf > 0.5) vf -= C.brakeForce * input.brake * dt;             // braking
      else vf = Math.max(vf - C.reverseAccel * input.brake * dt, -C.maxReverse); // reversing
    }

    // --- hills: gravity pulls the car down slopes and slows it going up ---
    if (!air) vf -= this.groundSlope * CONFIG.hills.slopeForce * dt;

    // --- resistance ---
    if (!air) vf -= vf * C.drag * dt;
    if (!air && surface.offroad && !boosting && vf > C.offroadMaxSpeed) vf -= (vf - C.offroadMaxSpeed) * C.offroadDrag * dt;

    // --- steering (smoothed so a jittery phone does not shake the car) ---
    this.steer += (input.steer - this.steer) * Math.min(1, CONFIG.input.steerSmoothing * dt);
    const speedFactor = clamp(Math.abs(vf) / C.steerMinSpeed, 0, 1);
    const falloff = 1 - C.steerSpeedFalloff * clamp(Math.abs(vf) / (C.maxSpeed * this.speedScale), 0, 1);
    const yawRate = -this.steer * C.steerRate * speedFactor * falloff * (this.drifting ? D.steerBoost : 1) * (air ? R.airSteer : 1) * Math.sign(vf || 1);
    this.heading += (yawRate + this.spin) * dt;
    this.spin *= Math.exp(-2.5 * dt);
    if (this.stun > 0) this.stun -= dt;

    // --- grip: kill sideways velocity (this is what drift will weaken later) ---
    if (!air) vl *= Math.exp(-C.grip * (this.drifting ? D.gripMultiplier : 1) * (this.stun > 0 ? 0.1 : 1) * dt);   // no grip in the air, little after a hit

    // recompose velocity with the NEW heading so the car turns instead of sliding wide
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    const nlx = Math.cos(this.heading), nlz = -Math.sin(this.heading);
    this.vx = nfx * vf + nlx * vl;
    this.vz = nfz * vf + nlz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.speed = vf;
    this.syncMesh();
  }

  syncMesh() {
    const m = this.mesh, u = m.userData;
    m.position.set(this.x, this.base + this.y, this.z);
    m.rotation.order = 'YXZ';
    m.rotation.y = this.heading;
    // pitch: follow the ramp slope, or nose up/down in flight (positive x-rotation = nose down)
    const wantPitch = this.airborne ? -clamp(this.vy * 0.03, -0.45, 0.45) : -Math.atan(this.groundSlope + (this.onRamp ? this.rampSlope : 0));
    this.pitch += (wantPitch - this.pitch) * 0.25;
    m.rotation.x = this.pitch;
    // little visual body roll / wheel steering
    u.body.rotation.z = this.steer * 0.06 * clamp(this.speed / 20, 0, 1);
    for (const w of u.frontWheels) w.rotation.y = -this.steer * 0.45;
    // blob shadow stays on the ground; shrinks with height
    u.shadow.position.y = 0.06 - this.y;
    u.shadow.scale.setScalar(1 / (1 + this.y * 0.25));
    // effects: turbo flame, drift sparks (colour shows how charged the meter is)
    u.flame.visible = this.turboTime > 0;
    if (u.flame.visible) u.flame.scale.set(1, 0.7 + Math.random() * 0.8, 1);
    u.beams.visible = Car.night;
    if (u.rainbow) u.under.material.color.setHSL((performance.now() / 1800) % 1, 1, 0.55);   // animated underglow
  }

  /**
   * Low-poly car: body type from look.body (see BODIES), glass cabin, kit / wing, glowing lights, exhausts, underglow.
   * All parts are placed relative to the body's length / height, so every body type gets the same extras.
   */
  static buildMesh(look) {
    const color = look.color, B = BODIES[look.body] || BODIES.coupe;
    // a little self-illumination so cars stay readable at night (ambient light is low there)
    const lam = col => new THREE.MeshLambertMaterial({ color: col, emissive: new THREE.Color(col).multiplyScalar(0.2), flatShading: true });
    const glo = col => new THREE.MeshBasicMaterial({ color: col });
    const dark = new THREE.Color(color).multiplyScalar(0.45).getHex();
    // body paint: plain colour, or a livery texture (the texture already contains the colour)
    const skin = skinTexture(look.skin, color);
    // metallic paint with a clear-coat sheen: reflects the scene's neon environment map
    const paint = new THREE.MeshStandardMaterial(skin ? { map: skin, emissive: 0xffffff, emissiveMap: skin, emissiveIntensity: 0.12 } : { color, emissive: new THREE.Color(color).multiplyScalar(0.1) });
    Object.assign(paint, { metalness: 0.55, roughness: 0.32, envMapIntensity: 1.3, flatShading: true });
    const black = lam(0x1a1a22), trim = lam(dark);
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1220, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.6, flatShading: true });
    const box = (w, h, d, mat, x, y, z, parent, rx = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
    };
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const { L, W, H, y } = B, ty = y + H / 2, F = L / 2, R = -L / 2;      // top of the chassis, front / rear ends

    // chassis, hood, rear deck, side skirts
    box(W, H, L, paint, 0, y, 0, body);
    box(W - 0.2, 0.22, B.hood[0], paint, 0, ty + 0.05, F - B.hood[0] / 2 - 0.05, body, B.hood[1]);
    if (B.deck) box(W - 0.2, 0.22, B.deck[0], paint, 0, ty + 0.1, R + B.deck[0] / 2 + 0.05, body, B.deck[1]);
    box(W + 0.1, 0.3, L - 0.1, trim, 0, y - H / 2 + 0.13, 0, body);
    // cabin: dark glass with a body-coloured roof; the windscreen leans back
    const C = B.cab, cy = ty + C.h / 2 + 0.05;
    box(C.w, C.h, C.l, glass, 0, cy, C.z, body);
    box(C.w - 0.12, 0.1, C.l * (B.longRoof ? 0.9 : 0.62), paint, 0, cy + C.h / 2 + 0.03, C.z - (B.longRoof ? 0 : C.l * 0.08), body);
    box(C.w - 0.1, C.h * 0.9, 0.12, glass, 0, cy - 0.02, C.z + C.l / 2 + 0.12, body, -0.55);
    // plain racing stripe (only on plain paint, liveries bring their own)
    if (!skin) {
      const stripe = glo(0xf4f4f4);
      box(0.34, 0.02, B.hood[0], stripe, 0, ty + 0.17, F - B.hood[0] / 2 - 0.05, body, B.hood[1]);
      box(0.34, 0.02, C.l * 0.6, stripe, 0, cy + C.h / 2 + 0.09, C.z, body);
    }
    // per-body details
    if (B.scoop) { box(0.7, 0.28, 0.9, black, 0, ty + 0.3, F - B.hood[0] * 0.55, body, B.hood[1]); }
    if (B.intakes) for (const sx of [-1, 1]) box(0.12, H * 0.7, 0.9, black, sx * (W / 2 + 0.02), y + 0.05, -0.4, body);
    if (B.flares) for (const sx of [-1, 1]) for (const wz of [B.wf, B.wr]) box(0.3, 0.32, 1.25, paint, sx * (W / 2 + 0.08), ty - 0.05, wz, body);
    if (B.bed) {
      for (const sx of [-1, 1]) box(0.14, 0.45, 1.9, paint, sx * (W / 2 - 0.07), ty + 0.22, R + 1.05, body);
      box(W, 0.45, 0.14, paint, 0, ty + 0.22, R + 0.08, body);
      box(W - 0.3, 0.06, 1.8, black, 0, ty + 0.02, R + 1.05, body);
      box(W - 0.2, 0.12, 0.12, lam(0x9aa0aa), 0, ty + C.h + 0.2, C.z - C.l / 2 + 0.1, body);   // roll bar
    }
    // lights: headlights front, tail lights rear (glowing)
    const lx = W / 2 - 0.35;
    for (const sx of [-lx, lx]) {
      box(0.5, 0.18, 0.1, glo(0xfff6c8), sx, y + 0.14, F + 0.02, body);
      box(0.55, 0.18, 0.1, glo(0xff2a2a), sx, y + 0.2, R - 0.02, body);
    }
    box(W - 1.3, 0.07, 0.1, glo(0xff2a2a), 0, y + 0.2, R - 0.02, body);
    box(W - 0.6, 0.14, 0.12, black, 0, y - 0.05, F + 0.02, body);                   // grille
    // body kit: 0 = big GT wing, 1 = rally (roof scoop + splitter), 2 = double wing, 3 = shark fin
    const wing = look.wing | 0, wz = R + 0.35, wy = ty + 0.85;
    if (wing === 0) {
      box(W + 0.4, 0.1, 0.7, black, 0, wy, wz, body);
      for (const sx of [-1, 1]) box(0.08, 0.35, 0.8, paint, sx * (W / 2 + 0.2), wy, wz, body);
      for (const sx of [-0.7, 0.7]) box(0.1, 0.85, 0.1, black, sx, ty + 0.42, wz + 0.05, body);
    } else if (wing === 1) {
      box(0.5, 0.3, 0.7, black, 0, cy + C.h / 2 + 0.18, C.z + 0.3, body);
      box(W + 0.2, 0.1, 0.5, black, 0, y - H / 2 - 0.02, F + 0.05, body);
      box(W - 0.1, 0.08, 0.5, black, 0, ty + 0.5, wz, body);
    } else if (wing === 2) {
      box(W + 0.4, 0.1, 0.6, black, 0, wy - 0.17, wz, body);
      box(W + 0.4, 0.1, 0.6, black, 0, wy + 0.28, wz - 0.15, body);
      for (const sx of [-1, 1]) box(0.08, 0.75, 0.9, paint, sx * (W / 2 + 0.2), wy + 0.06, wz - 0.05, body);
      for (const sx of [-0.7, 0.7]) box(0.1, 0.6, 0.1, black, sx, ty + 0.35, wz + 0.1, body);
    } else {
      box(0.14, 0.9, Math.min(1.9, C.l), paint, 0, cy + C.h / 2 + 0.4, C.z - 0.6, body, 0.12);   // tall centre fin
      box(W - 0.2, 0.08, 0.5, black, 0, ty + 0.48, wz, body);
    }
    // exhaust pipes
    for (const sx of [-0.55, 0.55]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 6), lam(0x888890));
      p.rotation.x = Math.PI / 2; p.position.set(sx, y - 0.12, R - 0.13); body.add(p);
    }

    // wheels with coloured rims (rear wheels can be bigger)
    const frontWheels = [];
    const rimCol = look.rims ?? 0xc8ccd8;
    const tyreMat = lam(0x15151a), rimMat = new THREE.MeshStandardMaterial({ color: rimCol, emissive: new THREE.Color(rimCol).multiplyScalar(0.25), metalness: 0.9, roughness: 0.25, envMapIntensity: 1.5, flatShading: true });
    for (const [sx, sz, front] of [[-B.wx, B.wf, true], [B.wx, B.wf, true], [-B.wx, B.wr, false], [B.wx, B.wr, false]]) {
      const r = front ? B.wheel : (B.rearWheel || B.wheel);
      const tyre = new THREE.CylinderGeometry(r, r, 0.55, 12); tyre.rotateZ(Math.PI / 2);
      const rim = new THREE.CylinderGeometry(r * 0.56, r * 0.56, 0.6, 6); rim.rotateZ(Math.PI / 2);
      const w = new THREE.Group();
      w.add(new THREE.Mesh(tyre, tyreMat), new THREE.Mesh(rim, rimMat));
      w.position.set(sx, r, sz); root.add(w);
      if (front) frontWheels.push(w);
    }

    // neon underglow: body colour, a chosen colour, or animated rainbow
    const rainbow = look.glow === 'rainbow';
    const under = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, L * 1.9), additive(rainbow || look.glow == null ? color : look.glow, glowTex(), look.glow == null ? 0.22 : 0.45));
    under.rotation.x = -Math.PI / 2; under.position.y = 0.12; root.add(under);

    // night lights: headlight pools on the road, glowing head / tail lamps
    const beams = new THREE.Group();
    for (const sx of [-0.7, 0.7]) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 19), additive(0xfff0cf, beamTex(), 0.16));
      pool.rotation.x = -Math.PI / 2; pool.rotation.z = sx * 0.05; pool.position.set(sx * 1.6, 0.14, F + 9.6); beams.add(pool);
    }
    root.add(beams);
    const lamp = (col, x, ly, z, size) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.scale.setScalar(size); s.position.set(x, ly, z); root.add(s);
    };
    for (const sx of [-lx, lx]) { lamp(0xb8ae90, sx, y + 0.14, F + 0.15, 1.1); lamp(0x9a1010, sx, y + 0.2, R - 0.15, 0.85); }

    // blob shadow
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(L / 2, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.x = W / L * 1.25; root.add(shadow);

    // turbo flames from both exhausts
    const flame = new THREE.Group();
    for (const sx of [-0.55, 0.55]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.4, 6), new THREE.MeshBasicMaterial({ color: look.flame ?? 0xffa21a }));
      f.rotation.x = -Math.PI / 2; f.position.set(sx, y - 0.12, R - 1.35); flame.add(f);
    }
    flame.visible = false; root.add(flame);

    const sparks = new THREE.Group(); sparks.visible = false; root.add(sparks);   // kept for compatibility, effects live in fx.js
    root.userData = { body, frontWheels, shadow, flame, sparks, under, rainbow, beams };
    return root;
  }
}

// Body types (garage "KAROSERIE"). L/W/H = chassis length / width / height, y = chassis centre height,
// hood / deck = [length, tilt], cab = glass cabin, wheel radius + positions (wx sideways, wf front z, wr rear z).
export const BODIES = {
  coupe:  { L: 4.3, W: 2.1, H: 0.5, y: 0.62, hood: [1.7, 0.16], deck: [1.2, -0.1], cab: { w: 1.6, h: 0.5, l: 1.9, z: -0.2 }, wheel: 0.5, wx: 1.15, wf: 1.45, wr: -1.4 },
  hatch:  { L: 3.8, W: 2.0, H: 0.55, y: 0.62, hood: [1.1, 0.2], deck: null, cab: { w: 1.75, h: 0.66, l: 2.2, z: -0.55 }, wheel: 0.48, wx: 1.1, wf: 1.2, wr: -1.25, longRoof: true },
  muscle: { L: 4.9, W: 2.2, H: 0.6, y: 0.68, hood: [2.1, 0.06], deck: [1.3, -0.04], cab: { w: 1.6, h: 0.46, l: 1.7, z: -0.45 }, wheel: 0.52, rearWheel: 0.62, wx: 1.2, wf: 1.65, wr: -1.6, scoop: true },
  super:  { L: 4.6, W: 2.3, H: 0.42, y: 0.52, hood: [1.9, 0.2], deck: [1.5, -0.06], cab: { w: 1.45, h: 0.42, l: 1.8, z: 0.0 }, wheel: 0.5, wx: 1.22, wf: 1.55, wr: -1.5, intakes: true },
  jdm:    { L: 4.6, W: 2.15, H: 0.52, y: 0.6, hood: [1.6, 0.12], deck: [1.0, -0.06], cab: { w: 1.65, h: 0.55, l: 2.3, z: -0.3 }, wheel: 0.5, wx: 1.18, wf: 1.5, wr: -1.5, flares: true },
  pickup: { L: 4.9, W: 2.2, H: 0.65, y: 0.82, hood: [1.5, 0.1], deck: null, cab: { w: 1.85, h: 0.72, l: 1.5, z: 0.45 }, wheel: 0.62, wx: 1.2, wf: 1.65, wr: -1.6, bed: true },
};
