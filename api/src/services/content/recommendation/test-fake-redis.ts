/**
 * Minimal in-memory ioredis stand-in for the recommendation services.
 *
 * Implements only the commands `RecommendationSessionService`,
 * `PostDetailRecommendationSessionService` and `RecommendationChainService`
 * actually issue — pipelined/multi rpush/hset/sadd/lpush/ltrim/expire/del, plus
 * hgetall/hget/hincrby/lrange/llen/smembers/scard/ttl directly — enough to
 * exercise real pagination, chain bookkeeping and TTL tracking without a live
 * Redis, mirroring how `post-stats-coalescer.service.spec.ts` fakes just the
 * commands it needs.
 *
 * The `ttls` map is deliberately a *record of the last EXPIRE*, not a clock:
 * these tests assert that an expiry was set and refreshed, never that a key
 * vanished.
 */
export function createFakeRedis() {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Record<string, string>>();
  const sets = new Map<string, Set<string>>();
  const ttls = new Map<string, number>();

  const client: any = {
    hgetall: jest.fn(async (key: string) => ({ ...(hashes.get(key) || {}) })),
    hget: jest.fn(async (key: string, field: string) => hashes.get(key)?.[field] ?? null),
    hset: jest.fn(async (key: string, ...args: any[]) => {
      const hash = hashes.get(key) || {};
      if (args.length === 1 && typeof args[0] === 'object') {
        Object.assign(hash, args[0]);
      } else {
        for (let i = 0; i < args.length; i += 2) hash[args[i]] = String(args[i + 1]);
      }
      hashes.set(key, hash);
      return 1;
    }),
    hincrby: jest.fn(async (key: string, field: string, by: number) => {
      const hash = hashes.get(key) || {};
      const next = (Number.parseInt(hash[field], 10) || 0) + by;
      hash[field] = String(next);
      hashes.set(key, hash);
      return next;
    }),
    lrange: jest.fn(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) || [];
      const end = stop === -1 ? list.length : stop + 1;
      return list.slice(start, end);
    }),
    llen: jest.fn(async (key: string) => (lists.get(key) || []).length),
    rpush: jest.fn(async (key: string, ...values: string[]) => {
      const list = lists.get(key) || [];
      list.push(...values);
      lists.set(key, list);
      return list.length;
    }),
    lpush: jest.fn(async (key: string, ...values: string[]) => {
      const list = lists.get(key) || [];
      // Redis pushes each argument in turn, so the LAST argument ends up first.
      values.forEach((value) => list.unshift(value));
      lists.set(key, list);
      return list.length;
    }),
    ltrim: jest.fn(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) || [];
      const end = stop === -1 ? list.length : stop + 1;
      lists.set(key, list.slice(start, end));
      return 'OK';
    }),
    sadd: jest.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key) || new Set<string>();
      members.forEach((member) => set.add(member));
      sets.set(key, set);
      return members.length;
    }),
    smembers: jest.fn(async (key: string) => [...(sets.get(key) || [])]),
    scard: jest.fn(async (key: string) => (sets.get(key) || new Set()).size),
    del: jest.fn(async (key: string) => {
      const existed = lists.delete(key) || hashes.delete(key) || sets.delete(key);
      ttls.delete(key);
      return existed ? 1 : 0;
    }),
    ttl: jest.fn(async (key: string) => (ttls.has(key) ? (ttls.get(key) as number) : -1)),
    expire: jest.fn(async (key: string, seconds: number) => {
      ttls.set(key, seconds);
      return 1;
    })
  };

  /** `pipeline()` and `multi()` differ only in atomicity, which an in-memory fake cannot lose. */
  const queue = () => {
    const ops: Array<() => Promise<any>> = [];
    const proxy: any = {
      rpush: (key: string, ...values: string[]) => { ops.push(() => client.rpush(key, ...values)); return proxy; },
      lpush: (key: string, ...values: string[]) => { ops.push(() => client.lpush(key, ...values)); return proxy; },
      ltrim: (key: string, start: number, stop: number) => { ops.push(() => client.ltrim(key, start, stop)); return proxy; },
      hset: (key: string, ...args: any[]) => { ops.push(() => client.hset(key, ...args)); return proxy; },
      sadd: (key: string, ...members: string[]) => { ops.push(() => client.sadd(key, ...members)); return proxy; },
      del: (key: string) => { ops.push(() => client.del(key)); return proxy; },
      expire: (key: string, seconds: number) => { ops.push(() => client.expire(key, seconds)); return proxy; },
      exec: async () => {
        const results = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const op of ops) {
          // eslint-disable-next-line no-await-in-loop
          results.push([null, await op()]);
        }
        return results;
      }
    };
    return proxy;
  };

  client.pipeline = jest.fn(queue);
  client.multi = jest.fn(queue);

  return {
    client, lists, hashes, sets, ttls
  };
}
