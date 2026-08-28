import * as crypto from 'crypto';
import { ObjectId } from 'mongodb';

import { AUTH_TOKEN_STATUS, AUTH_TOKEN_TYPE } from 'src/schemas/identity/auth';
import { AuthTokenService } from './auth-token.service';

/**
 * Token issue, claim and invalidation.
 *
 * The fake model below implements `findOneAndUpdate` the way MongoDB does — it
 * matches on the *whole* filter and mutates in one step — because that is the
 * property under test. A fake that read first and wrote second would pass every
 * assertion here while proving nothing about the thing that actually prevents
 * two requests from both consuming one token.
 */

interface StoredToken {
  _id: ObjectId;
  userId: any;
  type: string;
  tokenHash: string;
  email: string;
  status: string;
  expiresAt: Date;
  resolvedAt?: Date;
  createdAt: Date;
}

class FakeAuthTokenModel {
  documents: StoredToken[] = [];

  create = async (payload: any) => {
    if (this.documents.some((doc) => doc.tokenHash === payload.tokenHash)) {
      // Mirrors `idx_auth_token_hash_unique`.
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    const stored: StoredToken = { _id: new ObjectId(), createdAt: new Date(), ...payload };
    this.documents.push(stored);
    return stored;
  };

  /** Single-step match-and-mutate, as the real driver performs it. */
  findOneAndUpdate = async (filter: any, update: any, options: any) => {
    const match = this.documents.find((doc) => (
      doc.tokenHash === filter.tokenHash
      && doc.type === filter.type
      && doc.status === filter.status
      && doc.expiresAt.getTime() > filter.expiresAt.$gt.getTime()
    ));
    if (!match) return null;

    const before = { ...match };
    Object.assign(match, update.$set);
    return options?.returnDocument === 'before' ? before : match;
  };

  updateOne = async (filter: any, update: any) => {
    const match = this.documents.find((doc) => (
      `${doc._id}` === `${filter._id}` && (!filter.status || doc.status === filter.status)
    ));
    if (!match) return { modifiedCount: 0 };
    Object.assign(match, update.$set || {});
    Object.keys(update.$unset || {}).forEach((key) => delete (match as any)[key]);
    return { modifiedCount: 1 };
  };

  updateMany = async (filter: any, update: any) => {
    const matches = this.documents.filter((doc) => (
      `${doc.userId}` === `${filter.userId}`
      && doc.type === filter.type
      && doc.status === filter.status
      && (!filter._id || `${doc._id}` !== `${filter._id.$ne}`)
    ));
    matches.forEach((doc) => Object.assign(doc, update.$set));
    return { modifiedCount: matches.length };
  };

  countDocuments = async (filter: any) => this.documents.filter((doc) => (
    `${doc.userId}` === `${filter.userId}`
    && doc.type === filter.type
    && doc.createdAt.getTime() >= filter.createdAt.$gte.getTime()
  )).length;

  deleteMany = async (filter: any) => {
    const before = this.documents.length;
    this.documents = this.documents.filter((doc) => doc.expiresAt.getTime() >= filter.expiresAt.$lt.getTime());
    return { deletedCount: before - this.documents.length };
  };
}

function build() {
  const model = new FakeAuthTokenModel();
  const service = new AuthTokenService(model as any);
  return { service, model };
}

const USER_ID = new ObjectId();

async function issueVerification(service: AuthTokenService, overrides: Record<string, any> = {}) {
  return service.issue({
    userId: USER_ID,
    type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
    email: 'visitor@example.com',
    ttlMinutes: 60,
    ...overrides
  } as any);
}

describe('generating a token', () => {
  it('uses the OS CSPRNG, not Math.random', () => {
    // The reference implementation this replaces built tokens from
    // `Math.random()`, whose internal state is recoverable from a run of
    // outputs — the tokens were predictable, not merely short.
    const spy = jest.spyOn(crypto, 'randomBytes');
    const random = jest.spyOn(Math, 'random');

    AuthTokenService.generateRawToken();

    expect(spy).toHaveBeenCalledWith(32);
    expect(random).not.toHaveBeenCalled();

    spy.mockRestore();
    random.mockRestore();
  });

  it('produces 256 bits, URL-safe, and never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => AuthTokenService.generateRawToken()));

    expect(tokens.size).toBe(200);
    tokens.forEach((token) => {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // base64url of 32 bytes: nothing here needs percent-encoding in a URL.
      expect(encodeURIComponent(token)).toBe(token);
    });
  });
});

describe('storing a token', () => {
  it('never writes the raw token to any field', async () => {
    const { service, model } = build();

    const { rawToken } = await issueVerification(service);

    const [stored] = model.documents;
    // Not "the token column does not equal it" — no field anywhere may.
    Object.values(stored).forEach((value) => {
      expect(String(value)).not.toContain(rawToken);
    });
    expect(stored.tokenHash).toBe(
      crypto.createHash('sha256').update(rawToken).digest('hex')
    );
  });

  it('normalises the address the token was issued for', async () => {
    const { service, model } = build();

    await issueVerification(service, { email: '  Visitor@Example.COM ' });

    expect(model.documents[0].email).toBe('visitor@example.com');
  });

  it('starts active with the requested lifetime', async () => {
    const { service, model } = build();

    const before = Date.now();
    const { expiresAt } = await issueVerification(service, { ttlMinutes: 90 });

    expect(model.documents[0].status).toBe(AUTH_TOKEN_STATUS.ACTIVE);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(90 * 60 * 1000 - 50);
    expect(model.documents[0].resolvedAt).toBeUndefined();
  });
});

describe('claiming a token', () => {
  it('returns the row and consumes it in one step', async () => {
    const { service, model } = build();
    const { rawToken } = await issueVerification(service);

    const claimed = await service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);

    expect(claimed?.email).toBe('visitor@example.com');
    expect(model.documents[0].status).toBe(AUTH_TOKEN_STATUS.CONSUMED);
    expect(model.documents[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('refuses a second claim of the same token', async () => {
    const { service } = build();
    const { rawToken } = await issueVerification(service);

    await service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);

    expect(await service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).toBeNull();
  });

  it('refuses an expired token even though the row is still there', async () => {
    const { service, model } = build();
    const { rawToken } = await issueVerification(service);
    // The TTL index is housekeeping; expiry is the claim's own predicate. This
    // is exactly the state where those two differ.
    model.documents[0].expiresAt = new Date(Date.now() - 1000);

    expect(await service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).toBeNull();
    expect(model.documents).toHaveLength(1);
  });

  it('refuses an unknown token', async () => {
    const { service } = build();
    await issueVerification(service);

    expect(await service.claim('not-a-real-token', AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).toBeNull();
  });

  it('refuses a token presented for the wrong purpose', async () => {
    const { service } = build();
    const { rawToken } = await issueVerification(service);

    // A verification link must not be usable to reset a password.
    expect(await service.claim(rawToken, AUTH_TOKEN_TYPE.PASSWORD_RESET)).toBeNull();
  });

  it('refuses empty and non-string input without touching the database', async () => {
    const { service } = build();

    expect(await service.claim('', AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).toBeNull();
    expect(await service.claim(undefined as any, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).toBeNull();
  });

  it('lets exactly one of many simultaneous claims win', async () => {
    const { service } = build();
    const { rawToken } = await issueVerification(service);

    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION))
    );

    // The whole reason the check and the consume are one statement.
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('releasing a claim', () => {
  it('makes a consumed token usable again', async () => {
    const { service, model } = build();
    const { rawToken } = await issueVerification(service);
    const claimed = await service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);

    await service.release(claimed!.tokenId);

    expect(model.documents[0].status).toBe(AUTH_TOKEN_STATUS.ACTIVE);
    expect(model.documents[0].resolvedAt).toBeUndefined();
    expect(await service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).not.toBeNull();
  });

  it('will not revive a token a genuine sibling claim superseded', async () => {
    const { service, model } = build();
    const { rawToken } = await issueVerification(service);
    const claimed = await service.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    model.documents[0].status = AUTH_TOKEN_STATUS.SUPERSEDED;

    await service.release(claimed!.tokenId);

    expect(model.documents[0].status).toBe(AUTH_TOKEN_STATUS.SUPERSEDED);
  });

  it('does not throw when the database is unavailable', async () => {
    const { service, model } = build();
    model.updateOne = jest.fn().mockRejectedValue(new Error('down')) as any;

    // It runs while another failure is already being reported.
    await expect(service.release(new ObjectId())).resolves.toBeUndefined();
  });
});

describe('several tokens active at once', () => {
  it('leaves an earlier token working when a second is issued', async () => {
    const { service } = build();

    const first = await issueVerification(service);
    const second = await issueVerification(service);

    // The failure this design exists to avoid: overwriting the row would send
    // two emails of which only the newer link worked, so the first recipient
    // holds a link that silently does nothing.
    expect(await service.claim(first.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).not.toBeNull();
    expect(second.rawToken).not.toBe(first.rawToken);
  });

  it('invalidates the rest once one is used', async () => {
    const { service } = build();
    const first = await issueVerification(service);
    const second = await issueVerification(service);
    const third = await issueVerification(service);

    const claimed = await service.claim(first.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    const superseded = await service.supersedeSiblings({
      userId: USER_ID,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      exceptTokenId: claimed!.tokenId
    });

    expect(superseded).toBe(2);
    expect(await service.claim(second.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).toBeNull();
    expect(await service.claim(third.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)).toBeNull();
  });

  it('does not touch the other token type', async () => {
    const { service } = build();
    const reset = await service.issue({
      userId: USER_ID,
      type: AUTH_TOKEN_TYPE.PASSWORD_RESET,
      email: 'visitor@example.com',
      ttlMinutes: 60
    });
    await issueVerification(service);

    await service.supersedeSiblings({ userId: USER_ID, type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION });

    // Confirming an address must not cancel a reset the user asked for.
    expect(await service.claim(reset.rawToken, AUTH_TOKEN_TYPE.PASSWORD_RESET)).not.toBeNull();
  });

  it('does not throw when superseding fails', async () => {
    const { service, model } = build();
    model.updateMany = jest.fn().mockRejectedValue(new Error('down')) as any;

    // It runs after the real mutation already succeeded.
    await expect(service.supersedeSiblings({
      userId: USER_ID,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION
    })).resolves.toBe(0);
  });
});

describe('housekeeping', () => {
  it('counts recent issues for the cooldown', async () => {
    const { service } = build();
    await issueVerification(service);
    await issueVerification(service);

    const count = await service.countIssuedSince({
      userId: USER_ID,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      since: new Date(Date.now() - 60_000)
    });

    expect(count).toBe(2);
  });

  it('purges rows that expired before a cutoff', async () => {
    const { service, model } = build();
    await issueVerification(service);
    await issueVerification(service);
    model.documents[0].expiresAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const removed = await service.purgeExpired(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    expect(removed).toBe(1);
    expect(model.documents).toHaveLength(1);
  });
});
