// Online rooms: a thin client for the room messages of the server.
// The server only fans messages out; the HOST (room creator) decides the race settings and simulates the bots.
// Everybody simulates their own car and broadcasts its state ~20x per second.

import { CATALOG } from './catalog.js';

/** Names end up in HTML: keep letters, digits, space and a few symbols. */
export const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Hráč';

/** A car look received from the network: only known values (never trust other players' data). */
export function cleanLook(l) {
  const num = v => (Number.isFinite(+v) ? Math.max(0, Math.min(0xffffff, +v | 0)) : 0);
  l = l && typeof l === 'object' ? l : {};
  return {
    color: num(l.color),
    skin: CATALOG.skin.some(s => s.id === l.skin) ? l.skin : 'none',
    wing: Math.max(0, Math.min(3, +l.wing | 0)),
    rims: num(l.rims),
    glow: l.glow === 'rainbow' ? 'rainbow' : (l.glow == null ? null : num(l.glow)),
    flame: num(l.flame),
  };
}
const cleanPeer = p => ({ id: p.id, name: cleanName(p.name), look: cleanLook(p.look) });

export class Online {
  /** send(obj): function that writes to the game WebSocket. */
  constructor(send) {
    this._send = send;
    this.on = {};                        // callbacks set by main.js: room(), error(msg), message(from, data), peerLeft(id), host()
    this.pair = '';                      // pair code of THIS pc (phones pair with it)
    this.myId = null;
    this.reset();
  }

  reset() {
    this.active = false;
    this.code = null;                    // 4-letter room code
    this.you = null;                     // our player id in the room
    this.hostId = null;
    this.peers = new Map();              // id -> { id, name, look } (everybody except us)
  }

  get isHost() { return this.active && this.you === this.hostId; }

  create(name, look) { this._send({ t: 'room.create', name, look }); }
  join(code, name, look) { this._send({ t: 'room.join', code, name, look }); }
  leave() { this._send({ t: 'room.leave' }); this.reset(); }
  update(name, look) { if (this.active) this._send({ t: 'room.update', name, look }); }

  /** Broadcast game data to the others in the room (or to one player with `to`). */
  send(data, to) { if (this.active) this._send({ t: 'room.send', data, to }); }

  /** Feed every non-phone message from the server through here. Returns true when handled. */
  handle(m) {
    switch (m.t) {
      case 'hello': this.myId = m.id; this.pair = m.pair; if (this.on.hello) this.on.hello(m); return true;
      case 'room':
        this.active = true; this.code = m.code; this.you = m.you; this.hostId = m.host;
        this.peers = new Map(m.peers.filter(p => p.id !== m.you).map(p => [p.id, cleanPeer(p)]));
        if (this.on.room) this.on.room(); return true;
      case 'room.error': if (this.on.error) this.on.error(m.msg); return true;
      case 'peer+': case 'peer~':
        this.peers.set(m.peer.id, cleanPeer(m.peer)); if (this.on.room) this.on.room(); return true;
      case 'peer-':
        this.peers.delete(m.id); if (this.on.peerLeft) this.on.peerLeft(m.id); if (this.on.room) this.on.room(); return true;
      case 'host': this.hostId = m.id; if (this.on.host) this.on.host(); if (this.on.room) this.on.room(); return true;
      case 'rm': if (this.on.message) this.on.message(m.from, m.data); return true;
    }
    return false;
  }
}
