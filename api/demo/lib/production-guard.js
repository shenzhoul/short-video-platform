/**
 * Refusing to seed or wipe a production database by accident.
 *
 * `demo:seed` and `demo:clean` take their target from `MONGO_URI` in the
 * environment. That is the whole safety problem: the command that seeds a
 * laptop and the command that rewrites production are character-for-character
 * identical, and the only thing that differs is a variable somebody exported in
 * a shell twenty minutes ago. `demo:clean` in particular deletes 16 accounts,
 * 160 posts and every uploaded object behind them.
 *
 * So the target is *inferred and stated out loud*, and anything that is not
 * clearly a local database requires a deliberate opt-in.
 */

/**
 * Hosts that mean "this is my machine". Anything else — Atlas, a VPS, a tunnel,
 * a container hostname — is treated as remote, and therefore as production
 * unless told otherwise.
 *
 * Deliberately a whitelist. A blacklist of known-production hosts fails open on
 * the one host nobody remembered to add, and the failure mode is a wiped
 * database.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

function hostsOf(mongoUri) {
  try {
    // `mongodb+srv://user:pass@cluster.example.net/db` and the comma-separated
    // replica-set form both need the credentials stripped before parsing.
    const withoutCredentials = String(mongoUri).replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]*@/, '$1');
    const afterScheme = withoutCredentials.replace(/^mongodb(?:\+srv)?:\/\//, '');
    const authority = afterScheme.split('/')[0].split('?')[0];

    return authority
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const bracketed = entry.match(/^\[([^\]]+)\]/);
        if (bracketed) return bracketed[1];
        return entry.split(':')[0];
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Decide what kind of target this is.
 *
 * `NODE_ENV=production` and a remote host are each sufficient on their own. A
 * URI we cannot parse counts as remote too — an unreadable target is not a
 * reason to assume it is safe.
 */
function describeTarget(mongoUri) {
  const hosts = hostsOf(mongoUri);
  const unparseable = hosts.length === 0;
  const remoteHosts = hosts.filter((host) => !LOCAL_HOSTS.has(host));

  const reasons = [];
  if (process.env.NODE_ENV === 'production') reasons.push('NODE_ENV=production');
  if (remoteHosts.length) reasons.push(`MONGO_URI points at ${remoteHosts.join(', ')}`);
  if (unparseable) reasons.push('MONGO_URI host could not be parsed');

  return {
    hosts,
    isProduction: reasons.length > 0,
    reasons
  };
}

function isTrue(value) {
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
}

/**
 * Gate for `demo:seed`.
 *
 * Seeding a production database is a legitimate thing to want — this dataset is
 * the point of the deployment — so this is an opt-in, not a prohibition. What it
 * must never be is the *default*, reached by forgetting which shell you are in.
 *
 * @returns {{ allowed: boolean, target: object, message?: string }}
 */
function guardSeed(mongoUri) {
  const target = describeTarget(mongoUri);
  if (!target.isProduction) return { allowed: true, target };

  if (isTrue(process.env.ALLOW_PRODUCTION_DEMO_SEED)) {
    return {
      allowed: true,
      target,
      message: `Seeding a PRODUCTION target (${target.reasons.join('; ')}). `
        + 'Allowed by ALLOW_PRODUCTION_DEMO_SEED.'
    };
  }

  return {
    allowed: false,
    target,
    message: [
      'Refusing to seed: this looks like a production target.',
      ...target.reasons.map((reason) => `  - ${reason}`),
      '',
      'If that is intended, set ALLOW_PRODUCTION_DEMO_SEED=true for this command only:',
      '  ALLOW_PRODUCTION_DEMO_SEED=true yarn demo:seed',
      '',
      'Do not put it in .env — it is meant to be typed deliberately, once.'
    ].join('\n')
  };
}

/**
 * Gate for `demo:clean`.
 *
 * Stricter than seeding in two ways, because this one destroys data rather than
 * creating it:
 *
 *  1. It needs its **own** opt-in. Reusing the seed variable would mean the
 *     shell that was allowed to populate production is also allowed to empty
 *     it, and those are not the same decision.
 *  2. On a production target it forces `--dry-run` unless `--confirm-production`
 *     is also passed. So the mistyped command prints a plan; it does not delete
 *     anything.
 */
function guardClean(mongoUri, { dryRun, confirmProduction }) {
  const target = describeTarget(mongoUri);
  if (!target.isProduction) return { allowed: true, forceDryRun: false, target };

  if (!isTrue(process.env.ALLOW_PRODUCTION_DEMO_CLEAN)) {
    return {
      allowed: false,
      target,
      message: [
        'Refusing to clean: this looks like a production target.',
        ...target.reasons.map((reason) => `  - ${reason}`),
        '',
        'This deletes every demo account, post, and uploaded object in the ledger.',
        '',
        'To proceed, both of these are required:',
        '  ALLOW_PRODUCTION_DEMO_CLEAN=true    (env, typed for this command only)',
        '  --confirm-production                (argument)',
        '',
        'Run it once without --confirm-production first: that prints the deletion',
        'plan and changes nothing.'
      ].join('\n')
    };
  }

  if (!confirmProduction && !dryRun) {
    return {
      allowed: true,
      forceDryRun: true,
      target,
      message: [
        `PRODUCTION target (${target.reasons.join('; ')}).`,
        'Forcing --dry-run: no deletion without --confirm-production.'
      ].join('\n')
    };
  }

  return {
    allowed: true,
    forceDryRun: false,
    target,
    message: dryRun
      ? `PRODUCTION target (${target.reasons.join('; ')}) — dry run, nothing will be deleted.`
      : `DELETING demo data on a PRODUCTION target (${target.reasons.join('; ')}).`
  };
}

module.exports = {
  describeTarget, guardSeed, guardClean, LOCAL_HOSTS
};
