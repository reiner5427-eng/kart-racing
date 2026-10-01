import assert from 'node:assert/strict';
import { handleDuel } from './netlify/functions/duel.mts';

const data = new Map();
const store = {
  async get(key) { return data.get(key) ?? null; },
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && data.has(key)) return { modified: false };
    data.set(key, value);
    return { modified: true };
  },
};
let clock = 1_000_000;
const url = 'https://example.netlify.app/api/duel';
const send = body => handleDuel(new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), store, () => clock);
const read = (code, token) => handleDuel(new Request(`${url}?code=${code}&token=${token}`), store, () => clock);
const host = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const guest = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const outsider = 'ccccccc3-cccc-4ccc-8ccc-cccccccccccc';
const profile = (name, characterId) => ({ name, characterId });
const created = await send({ action: 'create', token: host, player: profile('호스트', 'pikachu') });
assert.equal(created.status, 201);
const room = await created.json();
assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);
assert.equal((await read(room.code, outsider)).status, 403);
const joined = await send({ action: 'join', code: room.code, token: guest, player: profile('게스트', 'snorlax') });
assert.equal(joined.status, 200);
assert.equal((await joined.json()).guest.name, '게스트');
assert.equal((await send({ action: 'join', code: room.code, token: outsider, player: profile('제삼자', 'eevee') })).status, 409);
assert.equal((await read(room.code, host)).status, 200);
const snapshot = (finishTime = null) => ({
  x: 1, z: 2, yaw: 0, vx: 0, vz: 18, speed: 18, lap: finishTime === null ? 1 : 3,
  checkpoint: 10, raceProgress: finishTime === null ? 1.4 : 3,
  elapsed: finishTime ?? 50_000, finishTime,
  lapTimes: finishTime === null ? [40_000] : [40_000, 41_000, finishTime - 81_000],
});
clock += 7000;
assert.equal((await send({ action: 'update', code: room.code, token: host, seq: 1, snapshot: snapshot() })).status, 200);
assert.equal((await send({ action: 'update', code: room.code, token: guest, seq: 1, snapshot: snapshot() })).status, 200);
assert.equal((await (await read(room.code, host)).json()).guestState.seq, 1);
assert.equal((await send({ action: 'update', code: room.code, token: host, seq: 2, snapshot: snapshot(120_000) })).status, 200);
assert.equal((await (await read(room.code, guest)).json()).winner, null);
clock += 1000;
assert.equal((await send({ action: 'update', code: room.code, token: guest, seq: 2, snapshot: snapshot(121_000) })).status, 200);
assert.equal((await (await read(room.code, host)).json()).winner, 'host');
await send({ action: 'update', code: room.code, token: host, seq: 1, snapshot: snapshot() });
assert.equal((await (await read(room.code, guest)).json()).hostState.finishTime, 120_000);
assert.equal((await send({ action: 'update', code: room.code, token: outsider, seq: 3, snapshot: snapshot() })).status, 403);
assert.equal((await send({ action: 'update', code: room.code, token: host, seq: 3, snapshot: { ...snapshot(), x: 9999 } })).status, 400);
const second = await (await send({ action: 'create', token: host, player: profile('호스트', 'pikachu') })).json();
await send({ action: 'join', code: second.code, token: guest, player: profile('게스트', 'eevee') });
const forfeited = await (await send({ action: 'leave', code: second.code, token: guest })).json();
assert.equal(forfeited.winner, 'host');
const third = await (await send({ action: 'create', token: host, player: profile('호스트', 'pikachu') })).json();
await send({ action: 'join', code: third.code, token: guest, player: profile('게스트', 'eevee') });
clock += 7000;
await send({ action: 'update', code: third.code, token: guest, seq: 1, snapshot: snapshot() });
await send({ action: 'update', code: third.code, token: host, seq: 1, snapshot: snapshot(120_000) });
clock += 21_000;
assert.equal((await (await read(third.code, host)).json()).winner, 'host');
assert.equal((await send({ action: 'update', code: third.code, token: guest, seq: 2, snapshot: snapshot(119_000) })).status, 409);
clock += 2 * 60 * 60 * 1000 + 1;
assert.equal((await read(room.code, host)).status, 410);
console.log('PASS 1:1 room creation, join, authorization, sync, finish order, expiry');
