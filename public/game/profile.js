// Player profile: coins, owned cosmetics, equipped items and upgrades. Saved in localStorage.
// (One shared profile for now; per-player profiles can come with multiplayer.)
import { CATALOG, UPGRADES, findItem } from './catalog.js';

const KEY = 'nitrobyte.profile';
const CATS = Object.keys(CATALOG);

function fresh() {
  const owned = {}, equipped = {};
  for (const cat of CATS) {
    owned[cat] = CATALOG[cat].filter(i => i.price === 0).map(i => i.id);
    equipped[cat] = CATALOG[cat][0].id;
  }
  return { coins: 0, owned, equipped, upgrades: { motor: 0, accel: 0, turbo: 0 }, totalEarned: 0 };
}

function load() {
  const base = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved) return base;
    for (const cat of CATS) {              // merge so newly added catalog items / categories still work
      base.owned[cat] = [...new Set([...base.owned[cat], ...((saved.owned || {})[cat] || [])])];
      const eq = (saved.equipped || {})[cat];
      if (eq && base.owned[cat].includes(eq)) base.equipped[cat] = eq;
    }
    base.coins = Math.max(0, saved.coins | 0);
    base.totalEarned = saved.totalEarned | 0;
    Object.assign(base.upgrades, saved.upgrades || {});
  } catch { /* corrupted save: start fresh */ }
  return base;
}

export const profile = load();
export function save() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* private mode */ } }

export function addCoins(n) { profile.coins += n; profile.totalEarned += Math.max(0, n); save(); }

export const owns = (cat, id) => profile.owned[cat].includes(id);

/** Buy (if needed) and equip an item. Returns 'equipped' | 'bought' | 'poor'. */
export function buyOrEquip(cat, id) {
  const item = findItem(cat, id);
  if (!owns(cat, id)) {
    if (profile.coins < item.price) return 'poor';
    profile.coins -= item.price; profile.owned[cat].push(id);
    profile.equipped[cat] = id; save();
    return 'bought';
  }
  profile.equipped[cat] = id; save();
  return 'equipped';
}

export const upgradeLevel = stat => profile.upgrades[stat];
export const upgradePrice = stat => UPGRADES[stat].prices[profile.upgrades[stat]] ?? null;   // null = maxed
export function buyUpgrade(stat) {
  const price = upgradePrice(stat);
  if (price === null) return 'max';
  if (profile.coins < price) return 'poor';
  profile.coins -= price; profile.upgrades[stat]++; save();
  return 'bought';
}

/** Car look from the equipped items; `override` = { cat: itemId } for previews in the garage. */
export function lookOf(override = {}) {
  const pick = cat => findItem(cat, override[cat] ?? profile.equipped[cat]);
  return {
    color: pick('color').value, body: pick('body').id, skin: pick('skin').id, wing: pick('wing').value,
    rims: pick('rims').value, glow: pick('glow').value, flame: pick('flame').value,
  };
}

/** Performance multipliers from the upgrades. */
export function perks() {
  const u = profile.upgrades;
  return { speed: 1 + UPGRADES.motor.per * u.motor, accel: 1 + UPGRADES.accel.per * u.accel, turbo: 1 + UPGRADES.turbo.per * u.turbo };
}
