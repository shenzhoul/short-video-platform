import { ObjectId } from 'mongodb';

/**
 * An in-memory stand-in for the notifications collection that actually
 * implements the MongoDB semantics the notification policies depend on.
 *
 * The policies are not "call the right method" logic — their correctness lives
 * in the shape of a single atomic upsert: which documents the filter matches,
 * what `$setOnInsert` contributes versus `$set`, how `$inc` behaves on an
 * absent field, and when the unique `(recipientId, groupKey)` index rejects an
 * insert. A mock that only records calls cannot show any of that, so the
 * behaviour is modelled here instead and the real service is exercised against
 * it.
 *
 * Only the operators the service actually uses are supported: equality, `$ne`
 * and `$lte`. Anything else is rejected loudly rather than silently ignored,
 * so this cannot drift into quietly passing a filter it does not understand.
 */

type Doc = Record<string, any>;

function identifier(value: any): string {
  if (value === null || value === undefined) return String(value);
  return value.toString();
}

function matchesCondition(actual: any, condition: any): boolean {
  if (condition && typeof condition === 'object' && !(condition instanceof ObjectId)
    && !(condition instanceof Date)) {
    const operators = Object.keys(condition);
    return operators.every((operator) => {
      switch (operator) {
        case '$ne':
          return identifier(actual) !== identifier(condition.$ne);
        case '$lte':
          return actual instanceof Date
            ? actual.getTime() <= new Date(condition.$lte).getTime()
            : actual <= condition.$lte;
        default:
          throw new Error(`Unsupported filter operator in test model: ${operator}`);
      }
    });
  }

  if (actual instanceof Date || condition instanceof Date) {
    return new Date(actual).getTime() === new Date(condition).getTime();
  }
  return identifier(actual) === identifier(condition);
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([field, condition]) => (
    matchesCondition(doc[field], condition)
  ));
}

/** MongoDB builds an upserted document from the filter's equality fields. */
function equalityFields(filter: Doc): Doc {
  const seed: Doc = {};
  Object.entries(filter).forEach(([field, condition]) => {
    const isOperator = condition && typeof condition === 'object'
      && !(condition instanceof ObjectId) && !(condition instanceof Date);
    if (!isOperator) seed[field] = condition;
  });
  return seed;
}

class DuplicateKeyError extends Error {
  code = 11000;

  constructor() {
    super('E11000 duplicate key error collection: notifications');
  }
}

/**
 * MongoDB refuses an update whose operators write the same path twice.
 *
 * Worth modelling because the failure is invisible in a naive fake: an upsert
 * that lists a field in both `$set` and `$setOnInsert` looks perfectly
 * reasonable and simply merges, while the real database rejects it outright and
 * creates nothing.
 */
class ConflictingUpdateOperatorsError extends Error {
  code = 40;

  constructor(path: string) {
    super(`Updating the path '${path}' would create a conflict at '${path}'`);
  }
}

function assertNoOperatorConflict(update: Doc) {
  const set = Object.keys(update.$set || {});
  const setOnInsert = new Set(Object.keys(update.$setOnInsert || {}));
  const increment = Object.keys(update.$inc || {});

  const conflict = [...set, ...increment].find((field) => setOnInsert.has(field))
    || increment.find((field) => set.includes(field));
  if (conflict) throw new ConflictingUpdateOperatorsError(conflict);
}

export class InMemoryNotificationModel {
  public docs: Doc[] = [];

  /** Set from a test to make the next write collide, modelling a lost race. */
  public onBeforeInsert: (() => void) | null = null;

  private uniqueKey(doc: Doc): string {
    return `${identifier(doc.recipientId)}|${doc.groupKey}`;
  }

  private assertUnique(doc: Doc) {
    const key = this.uniqueKey(doc);
    if (this.docs.some((existing) => this.uniqueKey(existing) === key)) {
      throw new DuplicateKeyError();
    }
  }

  private applyUpdate(doc: Doc, update: Doc) {
    Object.assign(doc, update.$set || {});
    Object.entries(update.$inc || {}).forEach(([field, amount]) => {
      doc[field] = (doc[field] || 0) + (amount as number);
    });
  }

  async create(input: Doc): Promise<Doc> {
    const doc = { _id: new ObjectId(), ...input };
    this.onBeforeInsert?.();
    this.assertUnique(doc);
    this.docs.push(doc);
    return { ...doc, toObject: () => ({ ...doc }) };
  }

  async findOne(filter: Doc): Promise<Doc | null> {
    const found = this.docs.find((doc) => matches(doc, filter));
    return found ? { ...found, toObject: () => ({ ...found }) } : null;
  }

  async exists(filter: Doc): Promise<{ _id: ObjectId } | null> {
    const found = this.docs.find((doc) => matches(doc, filter));
    return found ? { _id: found._id } : null;
  }

  async countDocuments(filter: Doc): Promise<number> {
    return this.docs.filter((doc) => matches(doc, filter)).length;
  }

  async findOneAndUpdate(filter: Doc, update: Doc, options: Doc = {}): Promise<Doc | null> {
    assertNoOperatorConflict(update);
    const existing = this.docs.find((doc) => matches(doc, filter));

    if (existing) {
      this.applyUpdate(existing, update);
      return { ...existing, toObject: () => ({ ...existing }) };
    }

    if (!options.upsert) return null;

    const inserted: Doc = {
      _id: new ObjectId(),
      ...equalityFields(filter),
      ...(update.$setOnInsert || {})
    };
    this.applyUpdate(inserted, update);

    this.onBeforeInsert?.();
    // The unique index is what makes concurrent first-events converge on one
    // row: a filter that missed because of `$ne` still collides here.
    this.assertUnique(inserted);
    this.docs.push(inserted);
    return { ...inserted, toObject: () => ({ ...inserted }) };
  }

  async updateOne(filter: Doc, update: Doc): Promise<{ modifiedCount: number }> {
    const found = this.docs.find((doc) => matches(doc, filter));
    if (!found) return { modifiedCount: 0 };
    this.applyUpdate(found, update);
    return { modifiedCount: 1 };
  }

  async updateMany(filter: Doc, update: Doc): Promise<{ modifiedCount: number }> {
    const found = this.docs.filter((doc) => matches(doc, filter));
    found.forEach((doc) => this.applyUpdate(doc, update));
    return { modifiedCount: found.length };
  }

  async deleteMany(filter: Doc): Promise<{ deletedCount: number }> {
    const remaining = this.docs.filter((doc) => !matches(doc, filter));
    const deletedCount = this.docs.length - remaining.length;
    this.docs = remaining;
    return { deletedCount };
  }

  async deleteOne(filter: Doc): Promise<{ deletedCount: number }> {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }

  /** Rows in a stable order for assertions. */
  byGroupKey(groupKey: string): Doc[] {
    return this.docs.filter((doc) => doc.groupKey === groupKey);
  }
}
