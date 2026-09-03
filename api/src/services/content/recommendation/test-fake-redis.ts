/**
 * Minimal in-memory ioredis stand-in for the recommendation session services.
 *
 * Only implements the handful of commands `RecommendationSessionService` and
 * `PostDetailRecommendationSessionService` actually issue (pipelined
 * rpush/hset/expire, plus hgetall/hget/lrange/llen/hset/expire directly) —
 * enough to exercise real pagination/ordering/TTL-tracking logic without a
 * live Redis, mirroring how `post-stats-coalescer.service.spec.ts` fakes just
 * the commands it needs.
 */
export function createFakeRedis() {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Record<string, string>>();
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
    expire: jest.fn(async (key: string, seconds: number) => {
      ttls.set(key, seconds);
      return 1;
    }),
    pipeline: jest.fn(() => {
      const ops: Array<() => Promise<any>> = [];
      const pipelineProxy: any = {
        rpush: (key: string, ...values: string[]) => { ops.push(() => client.rpush(key, ...values)); return pipelineProxy; },
        hset: (key: string, ...args: any[]) => { ops.push(() => client.hset(key, ...args)); return pipelineProxy; },
        expire: (key: string, seconds: number) => { ops.push(() => client.expire(key, seconds)); return pipelineProxy; },
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
      return pipelineProxy;
    })
  };

  return {
    client, lists, hashes, ttls
  };
}
