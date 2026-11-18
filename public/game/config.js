// ONE place for all tunable gameplay values.
// Units: metres, seconds. Tweak and reload the page.

export const CONFIG = {
  car: {
    maxSpeed: 38,          // top forward speed (m/s)
    maxReverse: 10,        // top reverse speed
    acceleration: 22,      // forward acceleration with throttle
    brakeForce: 40,        // deceleration with brake while moving forward
    reverseAccel: 12,      // acceleration when reversing after stop
    drag: 0.35,            // natural slow-down when coasting (1/s)
    offroadDrag: 2.2,      // extra slow-down outside the road
    offroadMaxSpeed: 16,   // speed cap outside the road

    steerRate: 2.1,        // max yaw rate (rad/s) at full steering
    steerMinSpeed: 2,      // below this speed steering is weak (can't spin in place)
    steerSpeedFalloff: 0.35, // 0..1 how much steering weakens at top speed

    grip: 9.0,             // how fast sideways velocity is killed (higher = on rails)
  },

  drift: {
    gripMultiplier: 0.12,  // grip while drifting (lower = slides more)
    steerBoost: 1.35,      // extra turn rate while drifting
    minSpeed: 14,          // drift needs at least this speed
    turboChargeRate: 0.35, // turbo meter gained per second of drifting
    minSteer: 0.2,         // must steer at least this much to charge the meter
  },
  turbo: {
    duration: 1.4,         // seconds at a full meter (shorter for a partial meter)
    minCharge: 0.25,       // meter needed to activate turbo
    speedBonus: 14,        // added to max speed during turbo
    accelBonus: 40,
    fovBoost: 14,          // camera FOV added during turbo
  },

  race: {
    totalDrivers: 6,       // grid is filled with bots up to this many cars
    countdown: 3,          // seconds before GO
    checkpoints: 8,        // evenly spaced checkpoints per lap (last one = finish line)
    carRadius: 1.9,        // car-to-car collision radius
    bumpForce: 1.5,        // how hard cars knock each other away (1 = plain bounce)
    bumpMax: 16,           // cap on the speed change from one hit (m/s)
    bumpStun: 0.7,         // seconds a hard-hit car slides with almost no grip
  },

  bots: {
    // Active difficulty preset (copied from CONFIG.difficulties by main.js when a race starts)
    preset: null,
    cornerSpeed: 0.55,     // legacy default, per-preset `corner` is used now
    steerGain: 2.6,        // how hard bots steer toward the racing line
    wander: 0.14,          // random sideways drift off the ideal line (fraction of road width)
    steerNoise: 0.05,      // random steering jitter
    driftBend: 0.38,       // bots drift when the corner ahead is at least this sharp (rad)
    turboBend: 0.25,       // bots use turbo when the road ahead bends less than this
    rubberPerCheckpoint: 0.04, // speed change per checkpoint (1/8 lap) of distance to the leading human
  },
  // Difficulty presets (menu: "Obtížnost botů").
  //  speed     top speed multiplier (1 = same as the player's base car)
  //  corner    fraction of top speed kept in the sharpest corners
  //  line      0..1 how well they use the racing line (and boost pads)
  //  mistakes  0..1 how often they steer badly
  //  rubberMax / rubberMin  extra speed for bots far behind / slow-down for bots far ahead
  difficulties: [
    { name: 'Lehká',   value: 0.45, speed: 0.90, corner: 0.48, line: 0.3, mistakes: 0.35, rubberMax: 0.06, rubberMin: -0.08 },
    { name: 'Střední', value: 0.7,  speed: 0.98, corner: 0.56, line: 0.6, mistakes: 0.2,  rubberMax: 0.12, rubberMin: -0.06 },
    { name: 'Těžká',   value: 0.9,  speed: 1.05, corner: 0.64, line: 0.95, mistakes: 0.06, rubberMax: 0.22, rubberMin: -0.02 },
    { name: 'Šílená',  value: 1.0,  speed: 1.12, corner: 0.70, line: 1.0, mistakes: 0.0,  rubberMax: 0.32, rubberMin: 0.0 },
  ],
  rocketStartChance: 0.9,  // chance a bot gets the rocket start = this * difficulty value

  hills: {
    slopeForce: 38,        // how strongly slopes pull the car: m/s^2 per unit of grade (0.1 = 10 %)
  },

  ramp: {
    gravity: 26,           // downward acceleration while airborne
    launch: 1.3,           // takeoff speed multiplier (higher = longer jumps)
    pop: 3,                // extra upward kick on takeoff (m/s)
    airSteer: 0.3,         // steering strength while airborne (0..1)
    airCharge: 0.3,        // turbo meter gained per second of air time
  },
  pads: {
    duration: 1.2,         // seconds of boost from a boost pad
  },
  rocketStart: {
    window: 0.9,           // press throttle within this many seconds before GO
    duration: 1.1,         // boost length
  },

  camera: {
    distance: 9,
    height: 4.2,
    lookAhead: 6,
    followSpeed: 5,        // how quickly the camera catches up
    fov: 65,
  },

  // Retro look: render at lower resolution, upscaled with hard pixels
  render: {
    pixelScale: 0.6,       // 1 = native, 0.5 = chunky pixels
    fogNear: 60,
    fogFar: 260,
  },

  // Input smoothing on the game side (phone also smooths)
  input: {
    steerSmoothing: 14,    // higher = snappier
    timeoutMs: 600,        // if no input for this long, treat the phone as released
  },
};
