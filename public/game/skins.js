// Livery textures for the car body, drawn pixel by pixel (32x32, nearest filtering).
import * as THREE from 'three';

const cache = new Map();
const css = c => '#' + c.toString(16).padStart(6, '0');

function shade(c, k) {
  const r = Math.min(255, ((c >> 16) & 255) * k) | 0, g = Math.min(255, ((c >> 8) & 255) * k) | 0, b = Math.min(255, (c & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}

/** Texture for `skin` painted on top of body colour `color` (number). Returns null for plain paint. */
export function skinTexture(skin, color) {
  if (!skin || skin === 'none') return null;
  const key = skin + ':' + color;
  if (cache.has(key)) return cache.get(key);
  const S = 32, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = css(color); g.fillRect(0, 0, S, S);
  const px = (x, y, w = 1, h = 1) => g.fillRect(x, y, w, h);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  if (skin === 'stripes') {                                   // twin racing stripes
    g.fillStyle = '#f4f4f4'; px(11, 0, 3, S); px(18, 0, 3, S);
    g.fillStyle = '#16161c'; px(14, 0, 1, S); px(17, 0, 1, S);
  } else if (skin === 'flames') {                             // flames licking up from the bottom
    for (let x = 0; x < S; x += 4) {
      const h = 8 + ((x * 7) % 9);
      g.fillStyle = '#ff7a1a'; px(x, S - h, 4, h);
      g.fillStyle = '#ffd21a'; px(x + 1, S - h * 0.6, 2, h * 0.6);
      g.fillStyle = '#ff3b1a'; px(x, S - h, 4, 1);
    }
  } else if (skin === 'checker') {                            // chequered flag band
    for (let y = 10; y < 22; y += 4) for (let x = 0; x < S; x += 4) { g.fillStyle = ((x + y) / 4) % 2 ? '#111' : '#fff'; px(x, y, 4, 4); }
  } else if (skin === 'camo') {                               // dark and light blobs
    for (let i = 0; i < 26; i++) { g.fillStyle = shade(color, i % 2 ? 0.55 : 1.35); px((rnd() * S) | 0, (rnd() * S) | 0, 3 + ((rnd() * 5) | 0), 2 + ((rnd() * 4) | 0)); }
  } else if (skin === 'tiger') {                              // black tiger stripes
    g.fillStyle = '#16100a';
    for (let x = -4; x < S; x += 7) for (let y = 0; y < S; y += 2) px(x + ((y * 3) % 5) + (y >> 2), y, 2, 2);
  } else if (skin === 'stars') {                              // night sky with stars
    g.fillStyle = shade(color, 0.3); g.fillRect(0, 0, S, S);
    g.fillStyle = '#ffffff'; for (let i = 0; i < 22; i++) px((rnd() * S) | 0, (rnd() * S) | 0);
    g.fillStyle = '#ffe14a'; for (let i = 0; i < 6; i++) { const x = (rnd() * 28) | 0, y = (rnd() * 28) | 0; px(x, y + 1, 3, 1); px(x + 1, y, 1, 3); }
  } else if (skin === 'grid') {                               // neon grid on dark paint
    g.fillStyle = shade(color, 0.25); g.fillRect(0, 0, S, S);
    g.fillStyle = '#35e8ff'; for (let i = 0; i < S; i += 8) { px(i, 0, 1, S); px(0, i, S, 1); }
    g.fillStyle = '#ff3bd0'; px(0, 4, S, 1); px(4, 0, 1, S);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}
