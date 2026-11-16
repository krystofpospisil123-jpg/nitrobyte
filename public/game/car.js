// Car: arcade physics + low-poly mesh. All numbers come from CONFIG.car.
// Convention: heading h, forward = (sin h, cos h) in the XZ plane. Steering right DEcreases h.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { skinTexture } from './skins.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Car {
  /** Default look for bots / extra players: plain paint in `cssColor`, wing style from `style`. */
  static defaultLook(cssColor, style = 0) {
    return { color: parseInt(String(cssColor).replace('#', ''), 16), skin: 'none', wing: style % 2, rims: 0xc8ccd8, glow: null, flame: 0xffa21a };
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
  update(dt, input, surface) {
    const C = CONFIG.car;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading); // left axis

    // split velocity into forward / sideways parts
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;

    const D = CONFIG.drift, T = CONFIG.turbo, R = CONFIG.ramp;
    this.landed = 0;

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
    this.heading += yawRate * dt;

    // --- grip: kill sideways velocity (this is what drift will weaken later) ---
    if (!air) vl *= Math.exp(-C.grip * (this.drifting ? D.gripMultiplier : 1) * dt);   // no grip in the air

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
    if (u.rainbow) u.under.material.color.setHSL((performance.now() / 1800) % 1, 1, 0.55);   // animated underglow
  }

  /** Low-poly sports car: wedge body, glass cabin, wing, glowing lights, exhausts, underglow. */
  static buildMesh(look) {
    const color = look.color;
    const lam = col => new THREE.MeshLambertMaterial({ color: col, flatShading: true });
    const glo = col => new THREE.MeshBasicMaterial({ color: col });
    const dark = new THREE.Color(color).multiplyScalar(0.45).getHex();
    // body paint: plain colour, or a livery texture (the texture already contains the colour)
    const skin = skinTexture(look.skin, color);
    const paint = skin ? new THREE.MeshLambertMaterial({ map: skin, flatShading: true }) : lam(color);
    const black = lam(0x1a1a22);
    const box = (w, h, d, mat, x, y, z, parent, rx = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
    };
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);

    // chassis + sloped hood and rear deck
    box(2.1, 0.5, 4.3, paint, 0, 0.62, 0, body);
    box(1.9, 0.22, 1.7, paint, 0, 0.92, 1.45, body, 0.16);                 // hood
    box(1.9, 0.22, 1.2, paint, 0, 0.98, -1.55, body, -0.1);                // rear deck
    box(2.2, 0.3, 4.2, lam(dark), 0, 0.38, 0, body);                       // side skirts
    // glass cabin: dark windows with a body-coloured roof
    box(1.6, 0.5, 1.9, lam(0x101a2a), 0, 1.2, -0.2, body);
    box(1.45, 0.1, 1.2, paint, 0, 1.5, -0.25, body);
    // plain racing stripe (only on plain paint, liveries bring their own)
    if (!skin) {
      const stripe = glo(0xf4f4f4);
      box(0.34, 0.02, 1.7, stripe, 0, 1.06, 1.45, body, 0.16);
      box(0.34, 0.02, 1.2, stripe, 0, 1.52, -0.25, body);
      box(0.34, 0.02, 1.2, stripe, 0, 1.1, -1.55, body, -0.1);
    }
    // lights: headlights front, tail lights rear (glowing)
    for (const sx of [-0.7, 0.7]) {
      box(0.5, 0.2, 0.12, glo(0xfff6c8), sx, 0.78, 2.17, body);
      box(0.55, 0.2, 0.1, glo(0xff2a2a), sx, 0.85, -2.17, body);
    }
    box(1.0, 0.08, 0.1, glo(0xff2a2a), 0, 0.85, -2.17, body);
    // body kit: 0 = big GT wing, 1 = rally (roof scoop + splitter), 2 = double wing, 3 = shark fin
    const wing = look.wing | 0;
    if (wing === 0) {
      box(2.5, 0.1, 0.7, black, 0, 1.72, -2.0, body);
      for (const sx of [-1.25, 1.25]) box(0.08, 0.35, 0.8, paint, sx, 1.72, -2.0, body);
      for (const sx of [-0.7, 0.7]) box(0.1, 0.5, 0.1, black, sx, 1.45, -1.95, body);
    } else if (wing === 1) {
      box(0.5, 0.35, 0.7, black, 0, 1.7, 0.2, body);
      box(2.3, 0.1, 0.5, black, 0, 0.3, 2.3, body);
      box(2.0, 0.08, 0.5, black, 0, 1.38, -2.05, body);
    } else if (wing === 2) {
      box(2.5, 0.1, 0.6, black, 0, 1.55, -2.05, body);
      box(2.5, 0.1, 0.6, black, 0, 2.0, -2.2, body);
      for (const sx of [-1.25, 1.25]) box(0.08, 0.75, 0.9, paint, sx, 1.78, -2.1, body);
      for (const sx of [-0.7, 0.7]) box(0.1, 0.55, 0.1, black, sx, 1.25, -1.9, body);
    } else {
      box(0.14, 1.0, 1.9, paint, 0, 2.0, -1.2, body, 0.12);                // tall centre fin
      box(1.9, 0.08, 0.5, black, 0, 1.35, -2.1, body);
    }
    // exhaust pipes
    for (const sx of [-0.55, 0.55]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 6), lam(0x888890));
      p.rotation.x = Math.PI / 2; p.position.set(sx, 0.5, -2.3); body.add(p);
    }

    // wheels with coloured rims
    const tyre = new THREE.CylinderGeometry(0.5, 0.5, 0.55, 10); tyre.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.28, 0.28, 0.6, 6); rim.rotateZ(Math.PI / 2);
    const frontWheels = [];
    for (const [sx, sz, front] of [[-1.15, 1.45, true], [1.15, 1.45, true], [-1.15, -1.4, false], [1.15, -1.4, false]]) {
      const w = new THREE.Group();
      w.add(new THREE.Mesh(tyre, lam(0x15151a)), new THREE.Mesh(rim, glo(look.rims ?? 0xc8ccd8)));
      w.position.set(sx, 0.5, sz); root.add(w);
      if (front) frontWheels.push(w);
    }

    // neon underglow: body colour, a chosen colour, or animated rainbow
    const rainbow = look.glow === 'rainbow';
    const under = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.8),
      new THREE.MeshBasicMaterial({ color: rainbow || look.glow == null ? color : look.glow, transparent: true, opacity: 0.55, depthWrite: false }));
    under.rotation.x = -Math.PI / 2; under.position.y = 0.12; root.add(under);

    // blob shadow
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.1, 10), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
    shadow.rotation.x = -Math.PI / 2; root.add(shadow);

    // turbo flames from both exhausts
    const flame = new THREE.Group();
    for (const sx of [-0.55, 0.55]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.4, 6), new THREE.MeshBasicMaterial({ color: look.flame ?? 0xffa21a }));
      f.rotation.x = -Math.PI / 2; f.position.set(sx, 0.5, -3.5); flame.add(f);
    }
    flame.visible = false; root.add(flame);

    const sparks = new THREE.Group(); sparks.visible = false; root.add(sparks);   // kept for compatibility, effects live in fx.js
    root.userData = { body, frontWheels, shadow, flame, sparks, under, rainbow };
    return root;
  }
}
