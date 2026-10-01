import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

export const config: Config = { path: '/api/duel' };

type Profile = { name: string; characterId: string };
type Room = { code: string; host: Profile; hostToken: string; createdAt: number };
type Guest = { profile: Profile; token: string; startAt: number };
type Snapshot = {
  x: number; z: number; yaw: number; vx: number; vz: number; speed: number;
  lap: number; checkpoint: number; raceProgress: number; elapsed: number;
  finishTime: number | null; lapTimes: number[];
};
type PlayerState = Snapshot & { seq: number; updatedAt: number; finishedAt: number | null; abandoned: boolean };
type Store = ReturnType<typeof getStore>;

const CHARACTERS = new Set(['pikachu', 'eevee', 'charmander', 'bulbasaur', 'pidgeotto', 'snorlax']);
const ROOM_LIFETIME = 2 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const roomKey = (code: string) => `rooms/${code}/meta`;
const guestKey = (code: string) => `rooms/${code}/guest`;
const stateKey = (code: string, role: 'host' | 'guest') => `rooms/${code}/${role}-state`;
const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const emptyState = (time: number): PlayerState => ({ x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0,
  lap: 0, checkpoint: 0, raceProgress: -1, elapsed: 0, finishTime: null, lapTimes: [],
  seq: 0, updatedAt: time, finishedAt: null, abandoned: false });

function codeValue(value: unknown): string | null {
  return typeof value === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(value.toUpperCase()) ? value.toUpperCase() : null;
}

function tokenValue(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{20,80}$/i.test(value);
}

function profileValue(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  if (typeof profile.name !== 'string' || typeof profile.characterId !== 'string') return null;
  const name = profile.name.trim();
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ]{1,12}$/.test(name) || !CHARACTERS.has(profile.characterId)) return null;
  return { name, characterId: profile.characterId };
}

function snapshotValue(value: unknown): Snapshot | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (!finite(s.x, -500, 500) || !finite(s.z, -500, 500) || !finite(s.yaw, -1000, 1000) ||
      !finite(s.vx, -100, 100) || !finite(s.vz, -100, 100) || !finite(s.speed, 0, 100) ||
      !Number.isInteger(s.lap) || !finite(s.lap, 0, 3) ||
      !Number.isInteger(s.checkpoint) || !finite(s.checkpoint, 0, 24) ||
      !finite(s.raceProgress, -2, 4) || !finite(s.elapsed, 0, ROOM_LIFETIME) ||
      !Array.isArray(s.lapTimes) || s.lapTimes.length > 3 ||
      !s.lapTimes.every(time => finite(time, 0, ROOM_LIFETIME))) return null;
  if (s.finishTime !== null && (!finite(s.finishTime, 0, ROOM_LIFETIME) ||
      s.lap !== 3 || s.lapTimes.length !== 3 ||
      Math.abs((s.lapTimes as number[]).reduce((sum, time) => sum + time, 0) - (s.finishTime as number)) > 10)) return null;
  return {
    x: s.x as number, z: s.z as number, yaw: s.yaw as number,
    vx: s.vx as number, vz: s.vz as number, speed: s.speed as number,
    lap: s.lap as number, checkpoint: s.checkpoint as number,
    raceProgress: s.raceProgress as number, elapsed: s.elapsed as number,
    finishTime: s.finishTime as number | null, lapTimes: s.lapTimes as number[],
  };
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

async function roomData(store: Store, code: string, now: number) {
  const room = await store.get(roomKey(code), { type: 'json' }) as Room | null;
  if (!room) return { error: json({ error: '방을 찾을 수 없습니다. 코드를 확인해주세요.' }, 404) };
  if (now - room.createdAt > ROOM_LIFETIME) return { error: json({ error: '방의 이용 시간이 끝났습니다. 새 방을 만들어주세요.' }, 410) };
  const [guest, initialHostState, initialGuestState] = await Promise.all([
    store.get(guestKey(code), { type: 'json' }) as Promise<Guest | null>,
    store.get(stateKey(code, 'host'), { type: 'json' }) as Promise<PlayerState | null>,
    store.get(stateKey(code, 'guest'), { type: 'json' }) as Promise<PlayerState | null>,
  ]);
  let hostState = initialHostState, guestState = initialGuestState;
  if (guest && hostState?.finishedAt && !guestState?.finishedAt && !guestState?.abandoned &&
      now - (guestState?.updatedAt ?? guest.startAt) > 20_000) {
    guestState = { ...(guestState ?? emptyState(guest.startAt)), abandoned: true, updatedAt: now };
    await store.setJSON(stateKey(code, 'guest'), guestState);
  }
  if (guest && guestState?.finishedAt && !hostState?.finishedAt && !hostState?.abandoned &&
      now - (hostState?.updatedAt ?? guest.startAt) > 20_000) {
    hostState = { ...(hostState ?? emptyState(guest.startAt)), abandoned: true, updatedAt: now };
    await store.setJSON(stateKey(code, 'host'), hostState);
  }
  return { room, guest, hostState, guestState };
}

function winner(hostState: PlayerState | null, guestState: PlayerState | null): 'host' | 'guest' | null {
  if (hostState?.finishedAt && guestState?.finishedAt)
    return hostState.finishTime! < guestState.finishTime! ? 'host' :
      guestState.finishTime! < hostState.finishTime! ? 'guest' :
      hostState.finishedAt <= guestState.finishedAt ? 'host' : 'guest';
  if (hostState?.finishedAt && guestState?.abandoned) return 'host';
  if (guestState?.finishedAt && hostState?.abandoned) return 'guest';
  if (hostState?.abandoned && !guestState?.abandoned) return 'guest';
  if (guestState?.abandoned && !hostState?.abandoned) return 'host';
  return null;
}

function publicRoom(data: Awaited<ReturnType<typeof roomData>>, role: 'host' | 'guest', now: number) {
  if (!data.room) throw new Error('Room missing');
  return {
    code: data.room.code, role, host: data.room.host,
    guest: data.guest?.profile ?? null, startAt: data.guest?.startAt ?? null,
    hostState: data.hostState ?? null, guestState: data.guestState ?? null,
    winner: winner(data.hostState ?? null, data.guestState ?? null), now,
  };
}

export async function handleDuel(request: Request, store: Store, now = () => Date.now()): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url), code = codeValue(url.searchParams.get('code'));
    const token = url.searchParams.get('token');
    if (!code || !tokenValue(token)) return json({ error: '방 코드와 참가자 인증이 필요합니다.' }, 400);
    const data = await roomData(store, code, now());
    if (data.error) return data.error;
    const role = token === data.room?.hostToken ? 'host' : token === data.guest?.token ? 'guest' : null;
    if (!role) return json({ error: '이 방의 참가자가 아닙니다.' }, 403);
    return json(publicRoom(data, role, now()));
  }
  if (request.method !== 'POST') return json({ error: '허용되지 않는 요청입니다.' }, 405);
  if (Number(request.headers.get('content-length')) > 4096) return json({ error: '요청 크기가 너무 큽니다.' }, 413);
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON 형식이 올바르지 않습니다.' }, 400); }
  if (!body || typeof body !== 'object' || !tokenValue(body.token)) return json({ error: '참가자 인증이 필요합니다.' }, 400);
  const time = now();
  if (body.action === 'create') {
    const host = profileValue(body.player);
    if (!host) return json({ error: '이름과 캐릭터를 확인해주세요.' }, 400);
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomCode(), room: Room = { code, host, hostToken: body.token, createdAt: time };
      const result = await store.setJSON(roomKey(code), room, { onlyIfNew: true });
      if (result.modified) return json({ code, role: 'host', host, guest: null, startAt: null, now: time }, 201);
    }
    return json({ error: '방 코드를 만들지 못했습니다. 다시 시도해주세요.' }, 503);
  }
  const code = codeValue(body.code);
  if (!code) return json({ error: '6자리 방 코드를 입력해주세요.' }, 400);
  const data = await roomData(store, code, time);
  if (data.error) return data.error;
  if (body.action === 'join') {
    const profile = profileValue(body.player);
    if (!profile) return json({ error: '이름과 캐릭터를 확인해주세요.' }, 400);
    if (body.token === data.room?.hostToken) return json({ error: '자신의 방에는 두 번째 참가자로 들어갈 수 없습니다.' }, 400);
    if (data.hostState?.abandoned) return json({ error: '방장이 나간 방입니다.' }, 410);
    if (data.guest && data.guest.token !== body.token) return json({ error: '이미 두 명이 참가한 방입니다.' }, 409);
    if (!data.guest) {
      const guest: Guest = { profile, token: body.token, startAt: time + 6500 };
      const result = await store.setJSON(guestKey(code), guest, { onlyIfNew: true });
      if (!result.modified) return json({ error: '이미 두 명이 참가한 방입니다.' }, 409);
    }
    const joined = await roomData(store, code, time);
    return json(publicRoom(joined, 'guest', time));
  }
  const role = body.token === data.room?.hostToken ? 'host' : body.token === data.guest?.token ? 'guest' : null;
  if (!role) return json({ error: '이 방의 참가자가 아닙니다.' }, 403);
  if (body.action === 'update' || body.action === 'leave') {
    const prior = role === 'host' ? data.hostState : data.guestState;
    if (body.action === 'update') {
      if (prior?.abandoned) return json({ error: '기권 처리된 경기에는 다시 참가할 수 없습니다.' }, 409);
      if (!data.guest || time < data.guest.startAt - 1000) return json({ error: '아직 레이스가 시작되지 않았습니다.' }, 409);
      if (!Number.isInteger(body.seq) || !finite(body.seq, 1, 10_000_000)) return json({ error: '동기화 순서가 올바르지 않습니다.' }, 400);
      const snapshot = snapshotValue(body.snapshot);
      if (!snapshot) return json({ error: '주행 데이터가 올바르지 않습니다.' }, 400);
      const seq = body.seq as number;
      if (!prior || seq > prior.seq) {
        const state: PlayerState = {
          ...snapshot, seq, updatedAt: time,
          finishedAt: prior?.finishedAt ?? (snapshot.finishTime !== null ? time : null),
          abandoned: prior?.abandoned ?? false,
        };
        if (prior?.finishTime !== null && prior?.finishTime !== undefined) {
          state.finishTime = prior.finishTime;
          state.lapTimes = prior.lapTimes;
          state.lap = 3;
        }
        await store.setJSON(stateKey(code, role), state);
      }
    } else {
      await store.setJSON(stateKey(code, role), {
        ...(prior ?? emptyState(time)),
        abandoned: true, updatedAt: time,
      });
    }
    const updated = await roomData(store, code, now());
    return json(publicRoom(updated, role, now()));
  }
  return json({ error: '알 수 없는 요청입니다.' }, 400);
}

export default async function duel(request: Request, _context: Context): Promise<Response> {
  try { return await handleDuel(request, getStore({ name: 'kart-rush-duels', consistency: 'strong' })); }
  catch (error) {
    console.error('Duel room error', error);
    return json({ error: '1:1 방에 일시적으로 연결할 수 없습니다.' }, 503);
  }
}
