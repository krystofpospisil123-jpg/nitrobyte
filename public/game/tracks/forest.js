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
    skyTop: 0x3f86c8, skyMid: 0x9fd0e8, skyBottom: 0xe2f2cc, sky: 0x9fd0e8,
    fog: 0xc4e4c4, fogNear: 70, fogFar: 330,
    backdrop: 'hills', hillColor: 0x2d6a4a,
    ground: 0x2f6b32,
    road: [0x7a5c3a, 0x836340], lane: 0xe8dcc0,
    kerb: [0xf2f2f2, 0x3b8a3e],
    ambient: 0xd8f0c8, sun: 0xfff3c4,
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
