import * as crypto from 'crypto';

import { AuthRateLimitService } from './auth-rate-limit.service';

/**
 * Per-identifier cooldowns for the endpoints that send email.
 *
 * The fake Redis below implements `SET NX EX` faithfully, because that atomicity
 * is the point: the check and the claim are one command, so two simultaneous
 * requests for the same address cannot both take the slot.
 */

class FakeRedis {
  store = new Map<string, { value: string; expiresAt: number | null }>();

  failing = false;

  private live(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  set = async (key: string, value: string, _ex: string, seconds: number, mode?: string) => {
    if (this.failing) throw new Error('redis down');
    if (mode === 'NX' && this.live(key)) return null;
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  };

  incr = async (key: string) => {
    if (this.failing) throw new Error('redis down');
    const entry = this.live(key);
    const next = entry ? Number(entry.value) + 1 : 1;
    this.store.set(key, { value: String(next), expiresAt: entry ? entry.expiresAt : null });
    return next;
  };

  expire = async (key: string, seconds: number) => {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  };

  ttl = async (key: string) => {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  };
}

function build() {
  const redis = new FakeRedis();
  return { redis, service: new AuthRateLimitService(redis as any) };
}

const LIMIT = {
  action: 'verification-resend',
  identifier: 'visitor@example.com',
  cooldownSeconds: 60,
  maxPerWindow: 5,
  windowSeconds: 24 * 60 * 60
};

describe('the cooldown', () => {
  it('allows the first request and refuses the next', async () => {
    const { service } = build();

    expect(await service.consume(LIMIT)).toBe('allowed');
    expect(await service.consume(LIMIT)).toBe('limited');
  });

  it('allows it again once the cooldown lapses', async () => {
    const { service, redis } = build();
    await service.consume(LIMIT);

    // Expire the cooldown without touching the daily window.
    redis.store.forEach((entry, key) => {
      if (key.includes(':cooldown:')) entry.expiresAt = Date.now() - 1;
    });

    expect(await service.consume(LIMIT)).toBe('allowed');
  });

  it('lets only one of several simultaneous requests through', async () => {
    const { service } = build();

    const results = await Promise.all(Array.from({ length: 8 }, () => service.consume(LIMIT)));

    // `SET NX EX` is one command: the check and the claim cannot be interleaved.
    expect(results.filter((r) => r === 'allowed')).toHaveLength(1);
  });

  it('tracks each identifier separately', async () => {
    const { service } = build();

    expect(await service.consume(LIMIT)).toBe('allowed');
    expect(await service.consume({ ...LIMIT, identifier: 'someone-else@example.com' })).toBe('allowed');
  });

  it('tracks each action separately', async () => {
    const { service } = build();

    expect(await service.consume(LIMIT)).toBe('allowed');
    // Asking for a password reset must not be blocked by having just asked for
    // a confirmation link.
    expect(await service.consume({ ...LIMIT, action: 'password-forgot' })).toBe('allowed');
  });
});

describe('the daily window', () => {
  it('refuses beyond the ceiling even when the cooldown is clear', async () => {
    const { service, redis } = build();

    const clearCooldown = () => redis.store.forEach((entry, key) => {
      if (key.includes(':cooldown:')) entry.expiresAt = Date.now() - 1;
    });

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect(await service.consume(LIMIT)).toBe('allowed');
      clearCooldown();
    }

    expect(await service.consume(LIMIT)).toBe('limited');
  });

  it('gives the window key a TTL, so a counter cannot pin somebody out for ever', async () => {
    const { service, redis } = build();

    await service.consume(LIMIT);

    const windowKey = [...redis.store.keys()].find((key) => key.includes(':window:'))!;
    expect(await redis.ttl(windowKey)).toBeGreaterThan(0);
  });
});

describe('privacy of the keys', () => {
  it('namespaces every key to this project', async () => {
    const { service, redis } = build();

    await service.consume(LIMIT);

    // The development Redis is shared with another project. A bare key names no
    // owner, which is how a cleanup eventually deletes somebody else's data.
    [...redis.store.keys()].forEach((key) => expect(key.startsWith('douyin-clone:')).toBe(true));
  });

  it('stores a hash, never the address itself', async () => {
    const { service, redis } = build();

    await service.consume(LIMIT);

    const keys = [...redis.store.keys()];
    // A Redis key is readable by anyone with Redis access and shows up in
    // MONITOR and in any keyspace dump.
    keys.forEach((key) => expect(key).not.toContain('visitor@example.com'));
    const expected = crypto.createHash('sha256').update('visitor@example.com').digest('hex');
    expect(keys.some((key) => key.includes(expected))).toBe(true);
  });

  it('normalises before hashing, so case cannot dodge the limit', async () => {
    const { service } = build();

    expect(await service.consume(LIMIT)).toBe('allowed');
    expect(await service.consume({ ...LIMIT, identifier: 'Visitor@Example.COM' })).toBe('limited');
  });
});

describe('when Redis is unavailable', () => {
  it('says so rather than guessing', async () => {
    const { service, redis } = build();
    redis.failing = true;

    // Three states, not two. "We could not find out" is genuinely different
    // from "no", and the caller decides which way to resolve it.
    expect(await service.consume(LIMIT)).toBe('unavailable');
  });

  it('fails CLOSED for a mail dispatch', async () => {
    const { service, redis } = build();
    redis.failing = true;

    // This limiter is the only thing bounding how many messages one Gmail
    // account sends, and Gmail throttles then locks a sender whose traffic
    // looks abusive. Failing open would turn "Redis is down" into "the send
    // limit is off" — precisely when an attacker would want it off, and not
    // self-correcting: a locked sender stays locked after Redis recovers.
    expect(await service.consumeForMailDispatch(LIMIT)).toBe(false);
  });

  it('allows a mail dispatch when Redis is healthy and within the limit', async () => {
    const { service } = build();

    expect(await service.consumeForMailDispatch(LIMIT)).toBe(true);
    // ...and refuses the second, which is the cooldown doing its job rather
    // than an outage.
    expect(await service.consumeForMailDispatch(LIMIT)).toBe(false);
  });

  it('logs the outage without the identifier, the address or a credential', async () => {
    const { service, redis } = build();
    redis.failing = true;
    const lines: string[] = [];
    jest.spyOn((service as any).logger, 'warn').mockImplementation((m: any) => { lines.push(String(m)); });

    await service.consumeForMailDispatch(LIMIT);

    const logged = lines.join('\n');
    expect(logged).not.toContain('visitor@example.com');
    // `error.message` is deliberately not logged: an ioredis connection error
    // can carry the host, the port and, on some auth failures, the credential
    // it tried.
    expect(logged).not.toContain('redis down');
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      event: 'auth_rate_limit_unavailable',
      action: 'verification-resend',
      outcome: 'mail_dispatch_suppressed'
    });
    // Enough to correlate repeated failures for one identifier, not enough to
    // reverse.
    expect(parsed.identifierHashPrefix).toHaveLength(12);
  });

  it('reports no cooldown rather than throwing', async () => {
    const { service, redis } = build();
    redis.ttl = jest.fn().mockRejectedValue(new Error('down')) as any;

    expect(await service.cooldownRemaining('verification-resend', 'visitor@example.com')).toBe(0);
  });
});
