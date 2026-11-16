// Everything that can be bought in the garage: cosmetics and performance upgrades.
// Add an item by adding a line here - the garage and the car builder pick it up automatically.
// price 0 = owned from the start.

export const CATALOG = {
  body: [    // car body type (shapes in car.js BODIES)
    { id: 'coupe', name: 'Sportovní kupé', price: 0 },
    { id: 'hatch', name: 'Hot hatch', price: 150 },
    { id: 'jdm', name: 'JDM sedan', price: 250 },
    { id: 'muscle', name: 'Muscle car', price: 300 },
    { id: 'pickup', name: 'Street pickup', price: 300 },
    { id: 'super', name: 'Supersport', price: 500 },
  ],
  color: [   // body paint (value = 0xRRGGBB)
    { id: 'red', name: 'Červená', price: 0, value: 0xe03030 },
    { id: 'blue', name: 'Modrá', price: 0, value: 0x2f6bff },
    { id: 'yellow', name: 'Žlutá', price: 0, value: 0xffc81a },
    { id: 'green', name: 'Zelená', price: 0, value: 0x2fc050 },
    { id: 'orange', name: 'Oranžová', price: 40, value: 0xff7a1a },
    { id: 'purple', name: 'Fialová', price: 40, value: 0x8a3df0 },
    { id: 'pink', name: 'Růžová', price: 60, value: 0xff4fa8 },
    { id: 'white', name: 'Bílá', price: 60, value: 0xf0f2f8 },
    { id: 'black', name: 'Černá', price: 80, value: 0x2a2a34 },
    { id: 'cyan', name: 'Tyrkysová', price: 80, value: 0x1fd8e8 },
    { id: 'gold', name: 'Zlatá', price: 300, value: 0xe0b020 },
    { id: 'chrome', name: 'Chrom', price: 300, value: 0xc4d0e0 },
    { id: 'lime', name: 'Limetková', price: 100, value: 0x9cff2a },
    { id: 'wine', name: 'Vínová', price: 100, value: 0x8a1530 },
    { id: 'graphite', name: 'Grafit mat', price: 120, value: 0x4a4e58 },
    { id: 'navy', name: 'Půlnoční modř', price: 120, value: 0x1a2a6a },
  ],
  skin: [    // livery pattern painted over the body colour (drawn in skins.js)
    { id: 'none', name: 'Čistý lak', price: 0 },
    { id: 'stripes', name: 'Pruhy', price: 60 },
    { id: 'flames', name: 'Plameny', price: 120 },
    { id: 'checker', name: 'Šachovnice', price: 150 },
    { id: 'camo', name: 'Maskáč', price: 200 },
    { id: 'tiger', name: 'Tygr', price: 200 },
    { id: 'stars', name: 'Hvězdy', price: 250 },
    { id: 'grid', name: 'Neonová mřížka', price: 300 },
    { id: 'fade', name: 'Přechod', price: 150 },
    { id: 'carbon', name: 'Karbon', price: 220 },
    { id: 'tribal', name: 'Tribal vinyl', price: 280 },
    { id: 'sponsor', name: 'Závodní polep #77', price: 320 },
    { id: 'splash', name: 'Barevné cákance', price: 350 },
    { id: 'kanji', name: 'Drift Tokio', price: 400 },
  ],
  wing: [    // rear wing / body kit style (index used by the car builder)
    { id: 'gt', name: 'GT křídlo', price: 0, value: 0 },
    { id: 'rally', name: 'Rallye', price: 0, value: 1 },
    { id: 'double', name: 'Dvojité křídlo', price: 120, value: 2 },
    { id: 'fin', name: 'Žraločí ploutev', price: 150, value: 3 },
  ],
  rims: [    // wheel rim colour
    { id: 'silver', name: 'Stříbrná', price: 0, value: 0xc8ccd8 },
    { id: 'black', name: 'Černá', price: 40, value: 0x333340 },
    { id: 'red', name: 'Červená', price: 40, value: 0xff3b3b },
    { id: 'cyan', name: 'Azurová', price: 40, value: 0x35e8ff },
    { id: 'pink', name: 'Růžová', price: 60, value: 0xff4fa8 },
    { id: 'gold', name: 'Zlatá', price: 100, value: 0xffd21a },
  ],
  glow: [    // underglow (value null = same as body colour, 'rainbow' = animated)
    { id: 'auto', name: 'Podle laku', price: 0, value: null },
    { id: 'white', name: 'Bílé', price: 40, value: 0xffffff },
    { id: 'cyan', name: 'Azurové', price: 50, value: 0x35e8ff },
    { id: 'pink', name: 'Růžové', price: 50, value: 0xff3bd0 },
    { id: 'green', name: 'Zelené', price: 70, value: 0x4aff6a },
    { id: 'orange', name: 'Oranžové', price: 70, value: 0xff9a1a },
    { id: 'rainbow', name: 'Duhové', price: 250, value: 'rainbow' },
  ],
  flame: [   // exhaust fire colour (turbo)
    { id: 'orange', name: 'Oranžový', price: 0, value: 0xffa21a },
    { id: 'white', name: 'Bílý', price: 80, value: 0xfff4d0 },
    { id: 'blue', name: 'Modrý', price: 100, value: 0x3a9bff },
    { id: 'green', name: 'Zelený', price: 120, value: 0x4aff6a },
    { id: 'purple', name: 'Fialový', price: 150, value: 0xc05aff },
  ],
};

// Performance upgrades: 3 levels each. `per` = bonus per level (multiplier on the stat).
export const UPGRADES = {
  motor: { name: 'MOTOR', desc: 'vyšší maximální rychlost', per: 0.04, prices: [150, 300, 600] },
  accel: { name: 'ZRYCHLENÍ', desc: 'rychlejší rozjezd', per: 0.08, prices: [120, 260, 500] },
  turbo: { name: 'TURBO', desc: 'rychlejší plnění měřiče', per: 0.2, prices: [150, 300, 600] },
};

export const REWARDS = [100, 60, 40, 25];     // coins for finishing 1st, 2nd, 3rd, 4th (others get FINISH_REWARD)
export const FINISH_REWARD = 10;

export const findItem = (cat, id) => CATALOG[cat].find(i => i.id === id) || CATALOG[cat][0];
