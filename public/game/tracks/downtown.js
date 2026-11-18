// Downtown: a night drive through city blocks - right-angle street corners, sidewalks, shops, side streets,
// traffic lights and parked cars (built by Track._buildStreets because theme.street is set).

// Street corners of the lap (x, z). The start is in the middle of the first street, heading +x.
const CORNERS = [[0, 120], [240, 120], [240, -120], [120, -120], [120, -360], [-120, -360], [-120, -120], [-240, -120], [-240, 120]];
const R = 20;                                   // corner radius in metres

/** Rounded right-angle corners + extra points along the straights so the spline stays straight. */
function streetLoop(corners, r) {
  const key = [], n = corners.length;
  const norm = (x, z) => { const l = Math.hypot(x, z); return [x / l, z / l]; };
  for (let i = 0; i < n; i++) {
    const [px, pz] = corners[(i - 1 + n) % n], [cx, cz] = corners[i], [nx, nz] = corners[(i + 1) % n];
    const [ax, az] = norm(px - cx, pz - cz), [bx, bz] = norm(nx - cx, nz - cz);
    if (ax * bx + az * bz < -0.99) { key.push([cx, cz]); continue; }          // not a corner (start point)
    key.push([cx + ax * r, cz + az * r], [cx + (ax + bx) * r * 0.293, cz + (az + bz) * r * 0.293], [cx + bx * r, cz + bz * r]);
  }
  const out = [];
  for (let i = 0; i < key.length; i++) {
    const [x0, z0] = key[i], [x1, z1] = key[(i + 1) % key.length];
    out.push([x0, z0]);
    const d = Math.hypot(x1 - x0, z1 - z0), parts = Math.floor(d / 40);
    for (let k = 1; k < parts; k++) out.push([x0 + (x1 - x0) * k / parts, z0 + (z1 - z0) * k / parts]);
  }
  return out;
}

export default {
  id: 'downtown',
  name: 'Centrum v noci',
  laps: 3,
  width: 14,

  points: streetLoop(CORNERS, R),
  start: { index: 0 },
  elevation: { waves: [[2, 2.2, 0.15], [3, 1.0, 0.6]] },       // gentle rises between the blocks
  terrain: { noise: 0, falloff: 40 },

  theme: {
    skyTop: 0x020309, skyMid: 0x0c1430, skyBottom: 0x6a3a48, sky: 0x0c1430,
    fog: 0x1a1426, fogNear: 50, fogFar: 300,
    stars: false,
    windows: true,
    backdrop: 'skyline', skylineColor: 0x1a1c40,
    ground: 0x16161c,
    road: [0x26262c, 0x29292f],
    lane: 0xe6dcb0,
    kerb: [0x8a8a92, 0x7c7c84],
    barrier: { height: 0.9, colors: [0x5a606c, 0x50566a], cap: 0x9aa0aa },      // railing along the sidewalk
    street: true,
    lampColors: [0xffb347, 0xffb347, 0xffd9a0, 0xa8d8ff],
    buildingColors: [0x7a5a48, 0x50586a, 0x6a6058, 0x5a4a5a, 0x8a7a62, 0x4a5058, 0x6a4a3a],
    night: true, moon: true, wet: 1, bloom: 0.22, bloomThreshold: 0.92, grade: 1, vignette: 0.42,
    neon: [0xffb347, 0xff2d9a, 0x35e8ff, 0xffd9a0],
    agents: { kind: 'heli', count: 1, height: 55, speed: 0.004 },
    ambient: 0x6a6aa8, ambientI: 1.1, sun: 0x8aa0d8, sunI: 0.9,
  },

  decor: [],
  overpasses: [{ kind: 'gantry', at: 0.035 }],
  pads: [{ at: 0.07, lane: 0.4 }, { at: 0.19, lane: -0.4 }, { at: 0.37, lane: 0 }, { at: 0.5, lane: 0.4 }, { at: 0.63, lane: -0.4 }, { at: 0.81, lane: 0.3 }, { at: 0.94, lane: -0.3 }],
  ramps: [{ at: 0.5, lane: 0, width: 8, length: 9, height: 1.6 }],
  seed: 21,
};
