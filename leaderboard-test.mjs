import assert from 'node:assert/strict';
import { handleRequest } from './netlify/functions/leaderboard.mts';

const records = new Map();
const store = {
  async list() { return { blobs: [...records.keys()].map(key => ({ key })) }; },
  async get(key) { return records.get(key) ?? null; },
  async setJSON(key, value) { records.set(key, value); },
  async delete(key) { records.delete(key); },
};
const url = 'https://example.netlify.app/api/leaderboard';
const post = value => handleRequest(new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
}), store);
const get = () => handleRequest(new Request(url), store);
const entry = (number, bestLapTime) => ({
  id: `race-${String(number).padStart(8, '0')}`,
  playerName: `레이서${number}`,
  characterId: 'snorlax', characterName: '잠만보',
  bestLapTime, totalTime: bestLapTime * 3 + 3000,
  lapTimes: [bestLapTime, bestLapTime + 1000, bestLapTime + 2000],
  mode: 'speed', date: new Date().toISOString(),
});

for (let i = 0; i < 12; i++) {
  const res = await post(entry(i, 50_000 - i * 1000));
  assert.equal(res.status, 200);
}
const rows = (await (await get()).json()).entries;
assert.equal(rows.length, 10);
assert.deepEqual(rows.map(row => row.bestLapTime),
  [39, 40, 41, 42, 43, 44, 45, 46, 47, 48].map(time => time * 1000));
assert.equal((await (await post(entry(11, 39_000))).json()).rank, 1);
assert.equal(records.size, 10);
assert.equal((await post({ ...entry(20, 40_000), bestLapTime: 1000 })).status, 400);
assert.equal((await post({ ...entry(20, 40_000), playerName: '<script>' })).status, 400);
assert.equal((await post({ ...entry(20, 40_000), lapTimes: [40_000] })).status, 400);
assert.equal((await handleRequest(new Request(url, { method: 'DELETE' }), store)).status, 405);
console.log('PASS online leaderboard ranking, top 10, idempotency, validation');
