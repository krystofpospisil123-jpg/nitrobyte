// Track data file. To add a track, copy this file, change the data and register it in main.js.
// Everything the engine needs is plain data: centre line, elevation, width, theme, decoration rules.

export default {
  id: 'city',
  name: 'Neonové město',
  laps: 3,
  width: 16,                      // road width in metres

  // Closed centre line as [x, z] control points (Catmull-Rom spline through them)
  points: [
    [0, 0], [70, -18], [140, 0], [208, -14], [260, -60], [264, -125], [300, -180], [286, -248], [240, -300],
    [175, -304], [120, -340], [55, -336], [0, -300], [-30, -250], [-80, -220], [-133, -223], [-180, -200],
    [-220, -147], [-280, -120], [-296, -60], [-280, 0], [-230, 30], [-200, 80], [-153, 103], [-100, 100],
    [-75, 72], [-40, 60], [-12, 35],
  ],

  // Start line sits at the first control point; grid is laid out behind it.
  start: { index: 0 },
  // Road height along the lap: sum of sine waves [frequency per lap, amplitude m, phase]
  elevation: { waves: [[2, 9, 0.1], [3, 4, 0.5], [5, 1.5, 0]] },
  terrain: { noise: 6, falloff: 40 },

  theme: {
    // sky gradient (top -> middle -> horizon), fog matches the horizon
    skyTop: 0x01020a, skyMid: 0x0a1238, skyBottom: 0x8a3a52, sky: 0x0a1238,    // night with an orange-pink city haze at the horizon
    fog: 0x1c1238, fogNear: 60, fogFar: 340,
    stars: true,
    windows: true,                // buildings get lit-window textures
    backdrop: 'skyline', skylineColor: 0x1a1a55,
    ground: 0x0e0c20,
    road: [0x26262e, 0x2b2b34],   // two tones alternate along the road for a sense of speed
    lane: 0xdfe6ff,
    kerb: [0xff3b3b, 0xf2f2f2],
    // "Underground" night look: wet glossy road, bloom on the neon, headlights on
    night: true, wet: 1, bloom: 0.22, bloomThreshold: 0.92, grade: 1, vignette: 0.4,
    neon: [0xff2d9a, 0x35e8ff, 0xff9a1a, 0x8a5cff],
    ambientI: 1.15, sunI: 1.1,
    // neon crash barrier: cars bounce off it
    barrier: { height: 1.4, colors: [0xff3bd0, 0x35e8ff, 0xff9a1a], cap: 0xffffff, glow: true },
    agents: { kind: 'hover', count: 4, height: 30, speed: 0.006 },   // police hover cars with searchlights
    ambient: 0x6a72c8,
    sun: 0x8aa4ff,
  },

  // Decoration rules: scattered with a seeded RNG so every run looks the same
  decor: [
    { kind: 'building', count: 130, minDist: 12, maxDist: 70, colors: [0x5b6bd6, 0xd65bb0, 0x4ec9d4, 0x8a8aa8, 0xf0a04b], height: [20, 75], size: [10, 20] },
    { kind: 'billboard', count: 24, minDist: 7, maxDist: 16, colors: [0xffffff] },
    { kind: 'lamp', count: 70, minDist: 3, maxDist: 4, colors: [0xffb347, 0xffb347, 0xffe2a8, 0x9fd8ff] },
  ],
  // Neon arches over the road: `at` = position along the lap (0..1)
  overpasses: [{ kind: 'gantry', at: 0.20 }, { kind: 'gantry', at: 0.52 }, { kind: 'gantry', at: 0.85 }],
  // Boost pads and ramps: `at` = position along the lap (0..1), `lane` = sideways (-1..1, + = left)
  pads: [{ at: 0.03, lane: 0.4 }, { at: 0.15, lane: -0.5 }, { at: 0.30, lane: 0.3 }, { at: 0.37, lane: 0 }, { at: 0.50, lane: -0.4 }, { at: 0.57, lane: 0.3 }, { at: 0.68, lane: -0.3 }, { at: 0.75, lane: 0.4 }, { at: 0.88, lane: -0.4 }, { at: 0.95, lane: 0 }],
  ramps: [
    { at: 0.08, lane: 0, width: 9, length: 9, height: 1.8 }, { at: 0.24, lane: 0, width: 10, length: 10, height: 2.0 },
    { at: 0.42, lane: 0, width: 9, length: 9, height: 1.8 }, { at: 0.60, lane: 0, width: 10, length: 10, height: 2.0 },
    { at: 0.80, lane: 0, width: 9, length: 9, height: 1.8 },
  ],
  seed: 7,
};
