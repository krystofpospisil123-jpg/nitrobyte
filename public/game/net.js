// WebSocket link from the game page to the server.
// Receives: local phones (join / leave / input), our pair code (hello) and online-room messages.
export function connect(h) {
  let ws;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?role=game`);
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'join') h.onJoin(m);
      else if (m.t === 'leave') h.onLeave(m);
      else if (m.t === 'input') h.onInput(m);
      else if (h.onMsg) h.onMsg(m);                 // hello, room, peer+, peer-, host, rm ...
    };
    ws.onclose = () => { if (h.onClose) h.onClose(); setTimeout(open, 1000); };   // auto-reconnect
  };
  open();
  return { send: obj => ws && ws.readyState === 1 && ws.send(JSON.stringify(obj)) };
}
