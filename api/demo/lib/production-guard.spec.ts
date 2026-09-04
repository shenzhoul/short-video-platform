/**
 * The gate between `yarn demo:clean` on a laptop and `yarn demo:clean` on the
 * live site.
 *
 * These two commands are identical text. The only thing separating them is
 * `MONGO_URI`, so the guard has to infer the target rather than be told it, and
 * it has to be wrong in the safe direction: a local database misread as
 * production costs one extra environment variable, while production misread as
 * local costs 16 accounts, 160 posts and every uploaded object behind them.
 *
 * Both halves are asserted below — that remote targets are caught, and that
 * ordinary local development is not made annoying by the guard.
 */

const { guardSeed, guardClean, describeTarget } = require('./production-guard');

const LOCAL = 'mongodb://localhost/douyin-clone';

/** `NODE_ENV` and the opt-ins are read from the environment at call time. */
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.NODE_ENV;
  delete process.env.ALLOW_PRODUCTION_DEMO_SEED;
  delete process.env.ALLOW_PRODUCTION_DEMO_CLEAN;
});

afterAll(() => {
  process.env = originalEnv;
});

describe('deciding what kind of database this is', () => {
  it.each([
    'mongodb://localhost/douyin-clone',
    'mongodb://127.0.0.1:27017/douyin-clone',
    'mongodb://localhost:27017/douyin-clone?replicaSet=rs0',
    'mongodb://host.docker.internal:27017/douyin-clone'
  ])('treats %s as local', (uri) => {
    expect(describeTarget(uri).isProduction).toBe(false);
  });

  it.each([
    'mongodb+srv://cluster0.abcde.mongodb.net/douyin-clone',
    'mongodb://10.0.0.5:27017/douyin-clone',
    'mongodb://db.example.com:27017/douyin-clone'
  ])('treats %s as production', (uri) => {
    expect(describeTarget(uri).isProduction).toBe(true);
  });

  it('strips credentials before parsing the host', () => {
    // A password containing `@` or `/` must not make the host unreadable — and
    // the host is what the whole decision rests on.
    const target = describeTarget('mongodb://admin:p%40ss%2Fword@localhost:27017/douyin-clone');
    expect(target.hosts).toEqual(['localhost']);
    expect(target.isProduction).toBe(false);
  });

  it('reads every host of a replica-set URI, not only the first', () => {
    // The dangerous shape: it starts local and reaches production anyway.
    const target = describeTarget('mongodb://localhost:27017,db.prod.example.com:27017/douyin-clone');
    expect(target.hosts).toEqual(['localhost', 'db.prod.example.com']);
    expect(target.isProduction).toBe(true);
  });

  it('treats an unparseable URI as production rather than assuming it is safe', () => {
    expect(describeTarget('').isProduction).toBe(true);
    expect(describeTarget('not-a-uri').isProduction).toBe(true);
  });

  it('treats NODE_ENV=production as production even against localhost', () => {
    process.env.NODE_ENV = 'production';
    expect(describeTarget(LOCAL).isProduction).toBe(true);
  });
});

describe('demo:seed', () => {
  it('runs against a local database with no ceremony', () => {
    const guard = guardSeed(LOCAL);
    expect(guard.allowed).toBe(true);
    expect(guard.message).toBeUndefined();
  });

  it('refuses a production target by default', () => {
    const guard = guardSeed('mongodb+srv://cluster0.abcde.mongodb.net/douyin-clone');
    expect(guard.allowed).toBe(false);
    expect(guard.message).toContain('ALLOW_PRODUCTION_DEMO_SEED');
  });

  it('names why it thinks the target is production, so the operator can disagree', () => {
    const guard = guardSeed('mongodb+srv://cluster0.abcde.mongodb.net/douyin-clone');
    expect(guard.message).toContain('cluster0.abcde.mongodb.net');
  });

  it('proceeds on an explicit opt-in, and says so', () => {
    process.env.ALLOW_PRODUCTION_DEMO_SEED = 'true';
    const guard = guardSeed('mongodb+srv://cluster0.abcde.mongodb.net/douyin-clone');
    expect(guard.allowed).toBe(true);
    expect(guard.message).toContain('PRODUCTION');
  });

  it('does not accept the seed opt-in as permission to clean', () => {
    process.env.ALLOW_PRODUCTION_DEMO_SEED = 'true';
    const guard = guardClean('mongodb+srv://cluster0.abcde.mongodb.net/db', {
      dryRun: false, confirmProduction: true
    });
    expect(guard.allowed).toBe(false);
  });
});

describe('demo:clean', () => {
  const PROD = 'mongodb+srv://cluster0.abcde.mongodb.net/douyin-clone';

  it('runs against a local database with no ceremony', () => {
    const guard = guardClean(LOCAL, { dryRun: false, confirmProduction: false });
    expect(guard.allowed).toBe(true);
    expect(guard.forceDryRun).toBe(false);
  });

  it('refuses a production target with no opt-in', () => {
    const guard = guardClean(PROD, { dryRun: false, confirmProduction: false });
    expect(guard.allowed).toBe(false);
    expect(guard.message).toContain('ALLOW_PRODUCTION_DEMO_CLEAN');
  });

  it('refuses even with --confirm-production when the env opt-in is absent', () => {
    // Two independent factors on purpose: a flag alone is one typo away.
    const guard = guardClean(PROD, { dryRun: false, confirmProduction: true });
    expect(guard.allowed).toBe(false);
  });

  /**
   * The mistyped-command case, and the reason this is a downgrade rather than a
   * refusal: the operator gets the deletion plan they would have needed anyway,
   * and nothing is deleted.
   */
  it('downgrades to a dry run when the env opt-in is set but the flag is not', () => {
    process.env.ALLOW_PRODUCTION_DEMO_CLEAN = 'true';
    const guard = guardClean(PROD, { dryRun: false, confirmProduction: false });
    expect(guard.allowed).toBe(true);
    expect(guard.forceDryRun).toBe(true);
    expect(guard.message).toContain('Forcing --dry-run');
  });

  it('deletes only when both the env opt-in and the flag are present', () => {
    process.env.ALLOW_PRODUCTION_DEMO_CLEAN = 'true';
    const guard = guardClean(PROD, { dryRun: false, confirmProduction: true });
    expect(guard.allowed).toBe(true);
    expect(guard.forceDryRun).toBe(false);
    expect(guard.message).toContain('DELETING');
  });

  it('keeps an explicit dry run a dry run', () => {
    process.env.ALLOW_PRODUCTION_DEMO_CLEAN = 'true';
    const guard = guardClean(PROD, { dryRun: true, confirmProduction: true });
    expect(guard.forceDryRun).toBe(false);
    expect(guard.message).toContain('nothing will be deleted');
  });

  it.each(['false', '0', 'no', '', 'TRUE ', undefined])(
    'treats ALLOW_PRODUCTION_DEMO_CLEAN=%p as not granting permission unless it is truthy',
    (value) => {
      if (value === undefined) delete process.env.ALLOW_PRODUCTION_DEMO_CLEAN;
      else process.env.ALLOW_PRODUCTION_DEMO_CLEAN = value;

      const guard = guardClean(PROD, { dryRun: false, confirmProduction: true });
      // 'TRUE ' is trimmed and lowercased, so it *is* permission; everything
      // else here is not.
      expect(guard.allowed).toBe(value === 'TRUE ');
    }
  );
});
