// Sunport multiplayer server — one shared world.
// Serves public/index.html (the game) and a WebSocket at /ws that relays: player state, proximity chat,
// ride-along seats and WebRTC signalling (voice is peer-to-peer; the server never touches audio).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = +process.env.PORT || 3000, MAX = +process.env.MAX_PLAYERS || 16;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
if (process.env.TURN_URL) ICE.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
// seats per vehicle type (must match src/seats.js)
const SEATS = { sedan: 4, taxi: 4, cop: 4, sport: 2, super: 2, muscle: 4, hatch: 4, limo: 8, jeep: 4, suv: 4, pickup: 4, ambulance: 4, truck: 2, bus: 24, monster: 2, tractor: 2, rickshaw: 3, motorbike: 2, bicycle: 1, speedboat: 4, jetski: 2 };
const CHAT_RANGE = 90, T0 = Date.now();
const hoursNow = () => (9.7 + (Date.now() - T0) / 1000 / 100) % 24; // 1 game hour = 100 s, same as the client

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, players: players.size })); return; }
  const f = path.join(ROOT, u === '/' ? 'index.html' : path.normalize(u).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found. Put the built game at server/public/index.html'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const players = new Map(); let nextId = 1;
const send = (p, o) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const bcast = (o, except) => { const s = JSON.stringify(o); for (const p of players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); };
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

function unseat(p, notify = true) {
  if (!p.ride) return; const host = players.get(p.ride.host); p.ride = null;
  if (notify) bcast({ t: 'seat', id: p.id, host: 0, seat: 0 });
}
function ejectPassengers(h) { for (const q of players.values()) if (q.ride && q.ride.host === h.id) unseat(q); }

wss.on('connection', (ws) => {
  if (players.size >= MAX) { ws.send(JSON.stringify({ t: 'err', m: 'Server is full (' + MAX + ' players). Try again in a moment.' })); ws.close(); return; }
  const p = { id: nextId++, ws, name: 'Player', look: null, s: null, ride: null, joined: false, lastChat: 0, alive: true, hostVeh: '' };
  ws.on('pong', () => { p.alive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'join': {
        if (p.joined) return; p.joined = true; p.name = clean(m.name, 16) || 'Player' + p.id; p.look = m.look && typeof m.look === 'object' ? m.look : null; players.set(p.id, p);
        send(p, { t: 'welcome', id: p.id, ice: ICE, time: hoursNow(), players: [...players.values()].filter((q) => q !== p).map((q) => ({ id: q.id, name: q.name, look: q.look, s: q.s, host: q.ride ? q.ride.host : 0, seat: q.ride ? q.ride.seat : 0 })) });
        bcast({ t: 'join', id: p.id, name: p.name, look: p.look }, p); break;
      }
      case 's': { // state: x,y,z,yaw,m(ode),sp, sw(im), g(round), vy, ch(ute), vt(vehicle type), vc(colour), pi(tch), ro(ll), st(eer), vf(wheel speed), lk(look yaw)
        if (!p.joined || !m.s) return; const s = m.s; p.s = { x: num(s.x), y: num(s.y), z: num(s.z), yaw: num(s.yaw), m: clean(s.m, 4), sp: num(s.sp), sw: s.sw ? 1 : 0, g: s.g ? 1 : 0, vy: num(s.vy), ch: s.ch ? 1 : 0, vt: clean(s.vt, 12), vc: num(s.vc), pi: num(s.pi), ro: num(s.ro), st: num(s.st), vf: num(s.vf), lk: num(s.lk), ins: clean(s.ins, 12), ho: s.ho ? 1 : 0 };
        if (p.ride) { const h = players.get(p.ride.host); if (!h || !h.s || h.s.m !== 'c' || !h.s.vt) unseat(p); }
        if (p.s.m !== 'c') ejectPassengers(p); else if (p.hostVeh && p.hostVeh !== p.s.vt) ejectPassengers(p);
        p.hostVeh = p.s.m === 'c' ? p.s.vt : '';
        bcast({ t: 's', id: p.id, s: p.s }, p); break;
      }
      case 'look': { if (!p.joined) return; p.look = m.look && typeof m.look === 'object' ? m.look : p.look; bcast({ t: 'look', id: p.id, look: p.look }, p); break; }
      case 'chat': {
        if (!p.joined) return; const now = Date.now(); if (now - p.lastChat < 700) return; p.lastChat = now; const txt = clean(m.m, 140); if (!txt) return;
        const o = { t: 'chat', id: p.id, name: p.name, m: txt, g: m.g ? 1 : 0 };
        for (const q of players.values()) { if (q === p) continue; if (m.g || (p.s && q.s && Math.hypot(p.s.x - q.s.x, p.s.z - q.s.z) < CHAT_RANGE)) send(q, o); }
        send(p, { ...o, echo: 1 }); break;
      }
      case 'emote': { if (!p.joined) return; bcast({ t: 'emote', id: p.id, e: clean(m.e, 12) }, p); break; }
      case 'board': {
        if (!p.joined) return; const h = players.get(+m.host); if (!h || h === p || !h.s || h.s.m !== 'c') { send(p, { t: 'denied', m: 'That vehicle is not available.' }); return; }
        if (p.s && h.s && Math.hypot(p.s.x - h.s.x, p.s.z - h.s.z) > 14) { send(p, { t: 'denied', m: 'Too far from the vehicle.' }); return; }
        const cap = SEATS[h.s.vt] || 2, taken = new Set([...players.values()].filter((q) => q.ride && q.ride.host === h.id).map((q) => q.ride.seat)); unseat(p, false);
        let seat = -1; const want = +m.seat; if (want > 0 && want < cap && !taken.has(want)) seat = want; else for (let i = 1; i < cap; i++) if (!taken.has(i)) { seat = i; break; }
        if (seat < 0) { send(p, { t: 'denied', m: 'No free seats.' }); return; }
        p.ride = { host: h.id, seat }; bcast({ t: 'seat', id: p.id, host: h.id, seat }); break;
      }
      case 'unboard': { if (p.joined) unseat(p); break; }
      case 'sig': { const q = players.get(+m.to); if (q && p.joined) send(q, { t: 'sig', from: p.id, d: m.d }); break; }
      case 'ping': send(p, { t: 'pong', c: m.c }); break;
    }
  });
  const gone = () => { if (!players.has(p.id)) return; ejectPassengers(p); unseat(p, false); players.delete(p.id); bcast({ t: 'leave', id: p.id }); };
  ws.on('close', gone); ws.on('error', gone);
});
setInterval(() => bcast({ t: 'time', h: hoursNow() }), 30000);
// drop dead sockets
setInterval(() => { for (const p of players.values()) { if (!p.alive) { p.ws.terminate(); continue; } p.alive = false; try { p.ws.ping(); } catch { /* ignore */ } } }, 20000);
server.listen(PORT, () => console.log(`Sunport server on :${PORT}  (max ${MAX} players)`));
