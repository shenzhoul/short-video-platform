/**
 * Collapse duplicate auth credentials and install the uniqueness index.
 *
 * The `auth` collection had no unique constraint on its logical credential key
 * (`{ userId, type }`), while `createAuthPassword` read-then-wrote — so two
 * concurrent calls for the same user could both find nothing and both insert.
 * Which of the resulting rows `getAuthPassword` returned was down to storage
 * order, meaning a password change could appear to work and then not.
 *
 * The write path is now a single atomic upsert. This script is the other half:
 * it clears any duplicates an existing database already accumulated and puts the
 * index in place, because `autoIndex` cannot change an existing index's options
 * — `createIndex` fails with a conflict against the non-unique
 * `idx_userId_type_management` that used to hold the same key.
 *
 * Usage:
 *   node scripts/repair-auth-credential-duplicates.js            # dry run (default)
 *   node scripts/repair-auth-credential-duplicates.js --apply    # collapse + index
 *
 * Mutation is never the default, this is never wired into startup or deploy, and
 * a second `--apply` on an already-repaired database changes nothing.
 *
 * Exit code 0 = clean (or repaired and verified). Non-zero = something still
 * needs a human; the output names it.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';

const OLD_INDEX = 'idx_userId_type_management';
const NEW_INDEX = 'idx_userId_type_unique_credential';

/**
 * Which row survives a duplicate group.
 *
 * Newest wins, and the ordering is `updatedAt`, then `createdAt`, then `_id`.
 *
 * That is not an arbitrary preference — it matches what the application already
 * does with these rows. A password change writes `updatedAt`, so the most
 * recently updated row is the one holding the password the user last set;
 * keeping an older one would silently restore a password they had replaced.
 * `createdAt` breaks a tie when timestamps are missing on legacy rows, and `_id`
 * is the final tiebreak because an ObjectId embeds its creation time and is
 * always present, so the policy is total and deterministic.
 *
 * A row with no usable credential never wins, whatever its timestamps: keeping
 * one would lock the account out. That check comes first.
 */
function pickKeeper(records) {
  const usable = records.filter((record) => typeof record.value === 'string' && record.value.length > 0);
  const candidates = usable.length ? usable : records;

  return [...candidates].sort((a, b) => {
    const updated = time(b.updatedAt) - time(a.updatedAt);
    if (updated !== 0) return updated;
    const created = time(b.createdAt) - time(a.createdAt);
    if (created !== 0) return created;
    return String(b._id).localeCompare(String(a._id));
  })[0];
}

function time(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A row that cannot authenticate anybody, whatever else is true of it. */
function isPoisoned(record) {
  if (!record.userId) return 'missing userId';
  if (!record.type) return 'missing type';
  if (typeof record.value !== 'string' || !record.value) return 'missing credential value';
  // A legacy value needs its salt to be verifiable at all; a scrypt value carries
  // its own salt inside the encoded string.
  if (!record.value.startsWith('scrypt$') && !record.salt) return 'legacy value with no salt';
  return null;
}

async function inspect(db) {
  const collection = db.collection('auth');

  const total = await collection.countDocuments();

  const groups = await collection.aggregate([
    {
      $group: {
        _id: { userId: '$userId', type: '$type' },
        count: { $sum: 1 },
        records: {
          $push: {
            _id: '$_id', value: '$value', salt: '$salt', createdAt: '$createdAt', updatedAt: '$updatedAt'
          }
        }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();

  const all = await collection.find({}).project({
    _id: 1, userId: 1, type: 1, value: 1, salt: 1
  }).toArray();
  const poisoned = all
    .map((record) => ({ record, reason: isPoisoned(record) }))
    .filter((entry) => entry.reason);

  const indexes = await collection.listIndexes().toArray();

  return {
    total, groups, poisoned, indexes
  };
}

function report({
  total, groups, poisoned, indexes
}) {
  console.log(`\ntotal auth records: ${total}`);
  console.log(`duplicate {userId, type} groups: ${groups.length}`);

  for (const group of groups) {
    const keeper = pickKeeper(group.records);
    const dropped = group.records.filter((record) => String(record._id) !== String(keeper._id));
    console.log(`\n  userId=${group._id.userId} type=${group._id.type}  (${group.count} records)`);
    console.log(`    keep   ${keeper._id}  updatedAt=${keeper.updatedAt || '-'} createdAt=${keeper.createdAt || '-'}`);
    dropped.forEach((record) => {
      console.log(`    remove ${record._id}  updatedAt=${record.updatedAt || '-'} createdAt=${record.createdAt || '-'}`);
    });
  }

  console.log(`\nmalformed records (kept, never deleted by this script): ${poisoned.length}`);
  poisoned.forEach((entry) => console.log(`  ${entry.record._id}  ${entry.reason}`));

  console.log('\nindexes currently on `auth`:');
  indexes.forEach((index) => {
    console.log(`  ${index.name} ${JSON.stringify(index.key)}${index.unique ? ' UNIQUE' : ''}`);
  });

  const hasUnique = indexes.some((index) => index.name === NEW_INDEX && index.unique);
  const hasSuperseded = indexes.some((index) => index.name === OLD_INDEX);
  console.log(`\nuniqueness index present: ${hasUnique ? 'yes' : 'NO'}`);
  if (hasSuperseded) {
    // Not harmful, but it indexes the same key without the constraint, so every
    // write to `auth` maintains a second copy for nothing. `--apply` drops it.
    // A database that ran `autoIndex` after the schema change has both.
    console.log(`superseded index still present: ${OLD_INDEX} (redundant; --apply removes it)`);
  }

  return {
    hasUnique,
    hasSuperseded,
    fixesNeeded: groups.length + (hasUnique ? 0 : 1) + (hasSuperseded ? 1 : 0)
  };
}

async function apply(db, groups) {
  const collection = db.collection('auth');

  let removed = 0;
  for (const group of groups) {
    const keeper = pickKeeper(group.records);
    const doomed = group.records
      .filter((record) => String(record._id) !== String(keeper._id))
      .map((record) => record._id);

    if (!doomed.length) continue;
    // Scoped by `_id` *and* by the group's own key, so a bug in the grouping
    // cannot reach a row belonging to somebody else.
    const result = await collection.deleteMany({
      _id: { $in: doomed },
      userId: group._id.userId,
      type: group._id.type
    });
    removed += result.deletedCount;
  }
  console.log(`\nremoved ${removed} duplicate record(s)`);

  const indexes = await collection.listIndexes().toArray();
  if (indexes.some((index) => index.name === OLD_INDEX)) {
    // The old index holds the same key without `unique`, so it has to go before
    // the new one can be created — `createIndex` refuses to redefine options.
    await collection.dropIndex(OLD_INDEX);
    console.log(`dropped superseded index ${OLD_INDEX}`);
  }

  if (!indexes.some((index) => index.name === NEW_INDEX)) {
    await collection.createIndex({ userId: 1, type: 1 }, { name: NEW_INDEX, unique: true });
    console.log(`created ${NEW_INDEX} (unique)`);
  } else {
    console.log(`${NEW_INDEX} already present`);
  }
}

(async () => {
  const connection = await mongoose.createConnection(URI).asPromise();
  let exitCode = 0;

  try {
    const db = connection.db;
    console.log(`database: ${db.databaseName}`);
    console.log(APPLY ? 'mode: APPLY (will modify data)' : 'mode: dry run (no writes)');

    const before = await inspect(db);
    const { fixesNeeded } = report(before);

    if (!APPLY) {
      console.log(`\ndry run complete — ${fixesNeeded} fix(es) would be applied. Re-run with --apply to perform them.`);
      return;
    }

    await apply(db, before.groups);

    // Read the state back from MongoDB rather than trusting what was just done.
    console.log('\n--- verification ---');
    const after = await inspect(db);
    const { hasUnique, fixesNeeded: remaining } = report(after);

    if (after.groups.length > 0) {
      console.log('\nFAILED: duplicate groups remain after repair');
      exitCode = 1;
    }
    if (!hasUnique) {
      console.log('\nFAILED: the uniqueness index was not created');
      exitCode = 1;
    }
    if (exitCode === 0) {
      console.log(`\nrepaired and verified — ${remaining} remaining fix(es)`);
    }
  } catch (error) {
    console.error('repair failed:', error?.message || error);
    exitCode = 2;
  } finally {
    await connection.close();
  }

  process.exit(exitCode);
})();
