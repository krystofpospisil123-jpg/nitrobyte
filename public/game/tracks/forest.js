// Forest track: narrow, twisty, rolling hills, lots of trees. Same data format as city.js.
export default {
  id: 'forest',
  name: 'Mechový les',
  laps: 3,
  width: 14,
  points: [
    [0, 0], [66, -8], [126, 21], [169, 68], [231, 84], [268, 130], [273, 189], [229, 222], [210, 273],
    [154, 278], [105, 252], [61, 285], [42, 336], [-1, 383], [-63, 399], [-120, 359], [-189, 357],
    [-226, 311], [-231, 252], [-176, 223], [-147, 168], [-184, 122], [-189, 63], [-142, 20],
    [-126, -42], [-87, -65], [-42, -63], [-30, -25],
  ],
  start: { index: 0 },
  // Road height along the lap: sum of sine waves [frequency per lap, amplitude m, phase]
  elevation: { waves: [[2, 11, 0.3], [3, 4, 0.1], [6, 1.5, 0.6]] },
  terrain: { noise: 14, falloff: 40 },        // hills away from the road
  theme: {
    // moonlit mountain road after the rain: dark forest, glossy asphalt, headlights on
    skyTop: 0x01040c, skyMid: 0x08183a, skyBottom: 0x1e4a5a, sky: 0x08183a, stars: true,
    fog: 0x0c2230, fogNear: 45, fogFar: 270,
    backdrop: 'hills', hillColor: 0x0b1f26,
    ground: 0x0b2412,
    road: [0x2b2a30, 0x302f36], lane: 0xdfe6ff,
    kerb: [0xf2f2f2, 0x2d8a3e],
    night: true, moon: true, wet: 0.8, bloom: 0.2, bloomThreshold: 0.92, grade: 1, vignette: 0.45,
    neon: [0x35e8ff, 0x2dff9a, 0xff2d9a, 0x8a5cff],
    ambient: 0x5a7ab0, ambientI: 1.0, sun: 0x9ab8ff, sunI: 1.0,
  },
  decor: [
    { kind: 'tree', count: 420, minDist: 3.5, maxDist: 60, colors: [0x1f6f2b, 0x2a8a35, 0x15572a, 0x3c9a3c] },
    { kind: 'rock', count: 70, minDist: 3, maxDist: 25, colors: [0x7d7d78, 0x66665f] },
  ],
  // Boost pads and ramps: `at` = position along the lap (0..1), `lane` = sideways (-1..1, + = left)
  pads: [{ at: 0.03, lane: -0.3 }, { at: 0.20, lane: 0.4 }, { at: 0.40, lane: 0 }, { at: 0.45, lane: -0.4 }, { at: 0.65, lane: 0.3 }, { at: 0.70, lane: -0.3 }, { at: 0.90, lane: 0.3 }],
  ramps: [{ at: 0.10, lane: 0, width: 8, length: 8, height: 1.7 }, { at: 0.30, lane: 0, width: 8, length: 8, height: 1.7 }, { at: 0.55, lane: 0, width: 8, length: 8, height: 1.7 }, { at: 0.80, lane: 0, width: 8, length: 8, height: 1.7 }],
  seed: 21,
};
