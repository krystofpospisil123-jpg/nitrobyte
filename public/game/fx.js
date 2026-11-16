// Visual effects: sparks, smoke / dust particles and tyre skid marks.
// Pure eye candy - nothing here affects the physics.
import * as THREE from 'three';

/** Pool of square point sprites (pixel look). Dead particles are parked far below the map. */
class Particles {
  constructor(count, size, { additive = false, opacity = 1 } = {}) {
    this.n = count; this.next = 0;
    this.pos = new Float32Array(count * 3).fill(-9999);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);       // seconds left (<=0 = free)
    this.max = new Float32Array(count).fill(1);
    this.drag = 0; this.gravity = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, vertexColors: true, sizeAttenuation: true, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this._c = new THREE.Color();
  }
  emit(x, y, z, vx, vy, vz, life, color) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = life;
    this._c.setHex(color); this.col.set([this._c.r, this._c.g, this._c.b], i * 3);
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) { this.pos[k + 1] = -9999; continue; }
      this.vel[k + 1] -= this.gravity * dt;
      const d = Math.max(0, 1 - this.drag * dt);
      this.vel[k] *= d; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.05 && this.gravity > 0) { this.pos[k + 1] = 0.05; this.vel[k + 1] *= -0.3; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/** Ring buffer of dark quads painted on the road behind drifting wheels. */
class Skids {
  constructor(count = 700) {
    this.n = count; this.next = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 1.3),
      new THREE.MeshBasicMaterial({ color: 0x050508, transparent: true, opacity: 0.55, depthWrite: false }), count);
    this.mesh.frustumCulled = false;
    const hide = new THREE.Matrix4().makeTranslation(0, -9999, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, hide);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
  }
  add(x, z, heading, y = 0) {
    this._e.set(-Math.PI / 2, 0, -heading, 'YXZ');            // lie flat, long side along the heading
    this._e.set(-Math.PI / 2, heading, 0, 'YXZ');
    this._q.setFromEuler(this._e);
    this._m.compose(this._p.set(x, y + 0.07, z), this._q, this._s);
    this.mesh.setMatrixAt(this.next, this._m);
    this.next = (this.next + 1) % this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.sparks = new Particles(500, 0.3, { additive: true });
    this.sparks.gravity = 14; this.sparks.drag = 1.5;
    this.smoke = new Particles(260, 1.3, { opacity: 0.5 });
    this.smoke.drag = 1.2;
    this.skids = new Skids();
    scene.add(this.sparks.points, this.smoke.points, this.skids.mesh);
    this._lastSkid = new Map();                // driver -> distance since the last skid mark
  }

  /** Emit effects for one driver for this frame. */
  driver(d, dt) {
    const c = d.car, fx = Math.sin(c.heading), fz = Math.cos(c.heading), lx = Math.cos(c.heading), lz = -Math.sin(c.heading);
    const rnd = () => Math.random() - 0.5, B = c.base;      // B = ground height under the car
    const speed = Math.abs(c.speed);
    const rear = side => [c.x - fx * 1.9 + lx * side * 1.15, c.z - fz * 1.9 + lz * side * 1.15];

    // drift: sparks at both rear wheels (colour = turbo charge), tyre smoke, skid marks
    if (c.drifting && !c.airborne) {
      const col = c.turboMeter >= 0.7 ? 0xff7a1a : c.turboMeter >= 0.25 ? 0xffd23a : 0x6fe0ff;
      for (const s of [-1, 1]) {
        const [x, z] = rear(s);
        for (let k = 0; k < 2; k++) this.sparks.emit(x, B + 0.3, z, -fx * 4 + lx * s * (3 + Math.random() * 5) + rnd() * 3, 2 + Math.random() * 4, -fz * 4 + lz * s * (3 + Math.random() * 5) + rnd() * 3, 0.35 + Math.random() * 0.3, col);
        if (Math.random() < 0.5) this.smoke.emit(x, B + 0.4, z, rnd() * 2, 1 + Math.random(), rnd() * 2, 0.8, 0xb8b8c8);
      }
      const acc = (this._lastSkid.get(d) || 0) + speed * dt;
      if (acc > 0.8) { this._lastSkid.set(d, 0); for (const s of [-1, 1]) { const [x, z] = rear(s); this.skids.add(x, z, c.heading, B); } }
      else this._lastSkid.set(d, acc);
    }

    // turbo / boost: fire from both exhausts
    if (c.turboTime > 0) {
      for (const s of [-0.55, 0.55]) {
        const x = c.x - fx * 2.5 + lx * s, z = c.z - fz * 2.5 + lz * s;
        for (let k = 0; k < 2; k++) this.sparks.emit(x, B + 0.55 + c.y, z, -fx * (8 + Math.random() * 8) + rnd() * 2, rnd() * 1.5, -fz * (8 + Math.random() * 8) + rnd() * 2, 0.25 + Math.random() * 0.2, Math.random() < 0.5 ? 0xffa21a : 0xffe36a);
      }
    }

    // off-road dust
    if (d.offroad && speed > 6 && !c.airborne && Math.random() < 0.7) {
      const [x, z] = rear(Math.random() < 0.5 ? -1 : 1);
      this.smoke.emit(x, B + 0.3, z, rnd() * 3 - fx * 2, 1.5 + Math.random() * 2, rnd() * 3 - fz * 2, 0.9, 0xc9a070);
    }

    // landing: ring of dust
    if (c.landed > 0.25) {
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * 6.28, v = 4 + Math.random() * 6;
        this.smoke.emit(c.x, B + 0.3, c.z, Math.cos(a) * v, 1 + Math.random() * 2, Math.sin(a) * v, 0.9, 0xd8d0c0);
        if (k % 2) this.sparks.emit(c.x, B + 0.3, c.z, Math.cos(a) * v, 3 + Math.random() * 4, Math.sin(a) * v, 0.4, 0xffe36a);
      }
    }

    // wall scrape: shower of sparks
    if (c.hitWall) for (let k = 0; k < 10; k++) this.sparks.emit(c.x + rnd() * 2, B + 0.6 + Math.random(), c.z + rnd() * 2, rnd() * 10, 2 + Math.random() * 5, rnd() * 10, 0.45, 0xffd070);
  }

  /** Little burst when a coin is picked up. */
  coin(x, y, z) {
    for (let k = 0; k < 10; k++) this.sparks.emit(x, y, z, (Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7, 0.45, 0xffd21a);
  }

  update(dt) { this.sparks.update(dt); this.smoke.update(dt); }
}
