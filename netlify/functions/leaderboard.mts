import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { MAX_ENTRIES, rankRecords, validateRecord, type RecordEntry } from './_shared/records.mts';

export const config: Config = { path: '/api/leaderboard' };

function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function storeFor() {
  return getStore({ name: 'kart-rush-hall', consistency: 'strong' });
}

type RecordStore = ReturnType<typeof storeFor>;

async function allRecords(store: RecordStore): Promise<RecordEntry[]> {
  const { blobs } = await store.list({ prefix: 'records/' });
  const records: RecordEntry[] = [];
  for (let index = 0; index < blobs.length; index += 20) {
    const batch = await Promise.all(blobs.slice(index, index + 20).map(blob => store.get(blob.key, { type: 'json' })));
    for (const item of batch) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && typeof item.bestLapTime === 'number') records.push(item as RecordEntry);
    }
  }
  return rankRecords(records);
}

export async function handleRequest(request: Request, store: RecordStore): Promise<Response> {
  if (request.method === 'GET') {
    const records = await allRecords(store);
    return response({ entries: records.slice(0, MAX_ENTRIES) });
  }
  if (request.method !== 'POST') return response({ error: '허용되지 않는 요청입니다.' }, 405);
  if (Number(request.headers.get('content-length')) > 4096) return response({ error: '요청 크기가 너무 큽니다.' }, 413);
  let input: unknown;
  try { input = await request.json(); }
  catch { return response({ error: 'JSON 형식이 올바르지 않습니다.' }, 400); }
  let record: RecordEntry;
  try { record = validateRecord(input); }
  catch (error) { return response({ error: error instanceof Error ? error.message : '기록이 올바르지 않습니다.' }, 400); }
  const key = `records/${record.id}`;
  const prior = await store.get(key, { type: 'json' });
  if (!prior) await store.setJSON(key, record);
  const records = await allRecords(store);
  const rank = records.findIndex(item => item.id === record.id) + 1;
  const outside = records.slice(MAX_ENTRIES);
  await Promise.all(outside.map(item => store.delete(`records/${item.id}`)));
  return response({ entry: prior || record, rank: rank || null, inTopTen: rank > 0 && rank <= MAX_ENTRIES });
}

export default async function leaderboard(request: Request, _context: Context): Promise<Response> {
  try { return await handleRequest(request, storeFor()); }
  catch (error) {
    console.error('Leaderboard storage error', error);
    return response({ error: '온라인 기록실에 일시적으로 연결할 수 없습니다.' }, 503);
  }
}
