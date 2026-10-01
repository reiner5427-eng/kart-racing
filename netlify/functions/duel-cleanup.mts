import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

export const config: Config = { schedule: '@daily' };

export default async function cleanup(_request: Request, _context: Context): Promise<Response> {
  const store = getStore({ name: 'kart-rush-duels', consistency: 'strong' });
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  let removed = 0;
  for await (const page of store.list({ prefix: 'rooms/', paginate: true })) {
    for (const blob of page.blobs) {
      if (!blob.key.endsWith('/meta')) continue;
      const room = await store.get(blob.key, { type: 'json' }) as { createdAt?: number } | null;
      if (!room || typeof room.createdAt !== 'number' || room.createdAt > cutoff) continue;
      const prefix = blob.key.slice(0, -4);
      await Promise.all(['meta', 'guest', 'host-state', 'guest-state'].map(name => store.delete(prefix + name)));
      removed++;
    }
  }
  return new Response(`Removed ${removed} expired 1:1 rooms`);
}
