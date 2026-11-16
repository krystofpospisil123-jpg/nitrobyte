// Desert canyon track: wide, very long, big climbs and descents, rock walls, oil derricks and a tunnel.
export default {
  id: 'desert',
  name: 'Pouštní kaňon',
  laps: 3,
  width: 19,
  points: [
    [0, 0], [96, -14], [190, 10], [288, 14], [380, -19], [437, -80], [513, -114], [526, -180], [513, -247],
    [448, -274], [399, -323], [319, -319], [247, -285], [219, -230], [171, -190], [110, -182], [57, -152],
    [-13, -158], [-76, -190], [-139, -173], [-190, -133], [-188, -74], [-209, -19], [-168, 24], [-114, 48], [-62, 12],
  ],
  start: { index: 0 },
  // One long climb and descent per lap plus smaller bumps
  elevation: { waves: [[1, 16, 0.0], [2, 8, 0.4], [4, 3, 0.2]] },
  terrain: { noise: 22, falloff: 40 },
  theme: {
    skyTop: 0x0e0830, skyMid: 0x8a2a4a, skyBottom: 0xff8a3a, sky: 0x8a2a4a,
    sunDisc: 0xffb860,
    fog: 0xb8603e, fogNear: 80, fogFar: 420,
    night: true, wet: 0, bloom: 0.22, bloomThreshold: 0.9, grade: 1.1, vignette: 0.4,      // dusk: lights on, glowing horizon
    backdrop: 'mesas', mesaColor: 0x7a3a3a,
    ground: 0xc07a3c,
    road: [0x4a4440, 0x524c47], lane: 0xe8e0c8,
    kerb: [0xc0392b, 0xf2f2f2],
    barrier: { height: 1.0, colors: [0x8a8a92, 0x70707a], cap: 0xd8d8dc },       // guard rail
    agents: { kind: 'heli', count: 3, height: 34, speed: 0.005 },
    tunnelColor: 0x6a3a2e,
    ambient: 0xffb890, ambientI: 1.15, sun: 0xffc890, sunI: 1.5,
  },
  decor: [
    { kind: 'cliff', count: 70, minDist: 28, maxDist: 75, colors: [0xb5603a, 0xc9783f, 0x9c4f30, 0xd98e4f] },
    { kind: 'derrick', count: 18, minDist: 16, maxDist: 70, colors: [0xffffff] },
    { kind: 'sign', count: 20, minDist: 3.5, maxDist: 6, colors: [0xffffff] },
    { kind: 'tyres', count: 34, minDist: 3.4, maxDist: 6, colors: [0xffffff] },
    { kind: 'cactus', count: 130, minDist: 6, maxDist: 70, colors: [0x3f8f4a, 0x4aa05a] },
    { kind: 'rock', count: 100, minDist: 6, maxDist: 70, colors: [0xb5744a, 0x9c6240, 0xc98a5a] },
  ],
  overpasses: [{ kind: 'tunnel', at: 0.15, length: 40 }, { kind: 'tunnel', at: 0.62, length: 40 }],
  pads: [{ at: 0.03, lane: 0.4 }, { at: 0.12, lane: -0.4 }, { at: 0.22, lane: 0 }, { at: 0.40, lane: 0.3 }, { at: 0.47, lane: -0.3 }, { at: 0.57, lane: 0.4 }, { at: 0.78, lane: 0 }, { at: 0.95, lane: 0 }],
  ramps: [
    { at: 0.07, lane: 0, width: 11, length: 11, height: 2.2 }, { at: 0.30, lane: 0, width: 11, length: 11, height: 2.2 },
    { at: 0.50, lane: 0, width: 11, length: 11, height: 2.2 }, { at: 0.70, lane: 0, width: 11, length: 11, height: 2.2 },
    { at: 0.88, lane: 0, width: 11, length: 11, height: 2.2 },
  ],
  seed: 5,
};
