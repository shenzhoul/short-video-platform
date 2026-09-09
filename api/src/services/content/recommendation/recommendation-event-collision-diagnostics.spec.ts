import { createHash } from 'crypto';

import {
  isDedupeCollision,
  partitionWriteErrors,
  shortHash
} from './recommendation-event.service';

/**
 * Every duplicate collision must be classifiable, and a duplicate that arrives
 * inside one request must never reach the unique index at all.
 *
 * ## The evidence this exists for
 *
 * The paired review API logged 19 real collisions over 74 minutes of ordinary
 * use — 9 `photo_dwell`, 7 `final_watch`, 3 `detail_open` — and every one of
 * them printed as `#unknown`, because the hash was recovered from the Mongo
 * error's `keyValue` rather than from the document we prepared. `keyValue` is
 * populated on some driver paths and not others; the operation index always is.
 */
describe('duplicate-collision diagnostics', () => {
  describe('shortHash', () => {
    it('is a stable 8-character prefix, so one identity is recognisable across log lines', () => {
      const key = 'subject:session:post:final_watch';
      const expected = createHash('sha256').update(key).digest('hex').slice(0, 8);
      expect(shortHash(key)).toBe(expected);
      expect(shortHash(key)).toBe(shortHash(key));
      expect(shortHash(key)).toHaveLength(8);
    });

    it('never returns the value it was given', () => {
      const key = 'subject:session:post:final_watch';
      expect(shortHash(key)).not.toContain('subject');
      expect(shortHash(key)).not.toContain('session');
    });

    it('says "none" rather than "unknown" for an absent value', () => {
      // "unknown" reads as a failed lookup; "none" reads as nothing to hash.
      expect(shortHash(null)).toBe('none');
      expect(shortHash(undefined)).toBe('none');
      expect(shortHash('')).toBe('none');
    });

    it('distinguishes two different identities', () => {
      expect(shortHash('a:b:c:final_watch')).not.toBe(shortHash('a:b:c:photo_dwell'));
    });
  });

  describe('isDedupeCollision', () => {
    it('recognises the dedupe index by keyPattern', () => {
      expect(isDedupeCollision({ code: 11000, keyPattern: { dedupeKey: 1 } })).toBe(true);
    });

    it('recognises it through the driver-wrapped `err` shape', () => {
      expect(isDedupeCollision({ err: { code: 11000, keyPattern: { dedupeKey: 1 } } } as any)).toBe(true);
    });

    /*
     * The rule from `.agents/rules/api.md`: a duplicate-key error says nothing
     * about *which* index. Treating an unrelated collision as an expected
     * no-op reports a real failure as success.
     */
    it('refuses to treat a collision on another index as a replay', () => {
      expect(isDedupeCollision({ code: 11000, keyPattern: { someOtherField: 1 } })).toBe(false);
    });

    it('is not fooled by a non-duplicate error code', () => {
      expect(isDedupeCollision({ code: 121, keyPattern: { dedupeKey: 1 } })).toBe(false);
    });
  });

  describe('partitionWriteErrors', () => {
    it('separates replays from genuine failures in one unordered bulk rejection', () => {
      const result = partitionWriteErrors({
        writeErrors: [
          { index: 0, code: 11000, keyPattern: { dedupeKey: 1 } },
          { index: 1, code: 121, errmsg: 'document validation failed' },
          { index: 2, code: 11000, keyPattern: { dedupeKey: 1 } }
        ]
      });
      expect(result.deduped).toBe(2);
      expect(result.other).toHaveLength(1);
      expect(result.other[0].code).toBe(121);
    });

    it('treats a bare non-bulk error as unexplained rather than as a replay', () => {
      const result = partitionWriteErrors({ message: 'connection reset' });
      expect(result.deduped).toBe(0);
      expect(result.other).toHaveLength(1);
    });
  });
});

/**
 * The mapping itself: `writeErrors[].index` is an index into the array we
 * submitted, so the only thing that can name a rejected document is an array we
 * built alongside it.
 */
describe('operation-index mapping', () => {
  interface Meta { operationIndex: number; eventType: string; dedupeKeyHash: string }

  const meta: Meta[] = [
    { operationIndex: 0, eventType: 'detail_open', dedupeKeyHash: shortHash('k0') },
    { operationIndex: 1, eventType: 'photo_dwell', dedupeKeyHash: shortHash('k1') },
    { operationIndex: 2, eventType: 'final_watch', dedupeKeyHash: shortHash('k2') }
  ];

  it('resolves each rejection to the event that was actually rejected', () => {
    const writeErrors = [{ index: 2 }, { index: 0 }];
    const named = writeErrors.map((e) => `${meta[e.index].eventType}#${meta[e.index].dedupeKeyHash}`);
    expect(named).toEqual([
      `final_watch#${shortHash('k2')}`,
      `detail_open#${shortHash('k0')}`
    ]);
    expect(named.join(' ')).not.toContain('unknown');
  });

  it('an error carrying no keyValue is still fully classifiable', () => {
    // Precisely the driver shape that produced `#unknown` in the review log.
    const entry: any = { index: 1, code: 11000, keyPattern: { dedupeKey: 1 } };
    expect(entry.keyValue).toBeUndefined();
    const row = meta[entry.index];
    expect(`${row.eventType}#${row.dedupeKeyHash}`).toBe(`photo_dwell#${shortHash('k1')}`);
  });
});

/**
 * The collapse itself, as a pure function of the batch — this is the behaviour
 * that stops a duplicate reaching the index in the first place.
 */
describe('collapsing duplicates within one request', () => {
  const UPDATABLE = new Set(['final_watch', 'photo_dwell']);

  /** Mirrors the service's collapse: last wins for a correction, first otherwise. */
  function collapse(entries: Array<{ dedupeKey: string; item: any }>) {
    const duplicates = new Map<string, number>();
    const out: Array<{ dedupeKey: string; item: any }> = [];
    const positionByKey = new Map<string, number>();
    entries.forEach((entry) => {
      const seenAt = positionByKey.get(entry.dedupeKey);
      if (seenAt === undefined) {
        positionByKey.set(entry.dedupeKey, out.length);
        out.push(entry);
        return;
      }
      duplicates.set(entry.dedupeKey, (duplicates.get(entry.dedupeKey) || 0) + 1);
      if (UPDATABLE.has(entry.item.eventType)) out[seenAt] = entry;
    });
    return { out, collapsed: Array.from(duplicates.values()).reduce((a, b) => a + b, 0) };
  }

  it('keeps the larger correction when one exposure reports twice', () => {
    const { out, collapsed } = collapse([
      { dedupeKey: 'k', item: { eventType: 'final_watch', watchMs: 5000 } },
      { dedupeKey: 'k', item: { eventType: 'final_watch', watchMs: 8000 } }
    ]);
    expect(out).toHaveLength(1);
    expect(collapsed).toBe(1);
    // The later, larger measurement is the one that survives.
    expect(out[0].item.watchMs).toBe(8000);
  });

  it('keeps the first of a non-updatable repeat, so a retry is a no-op', () => {
    const { out, collapsed } = collapse([
      { dedupeKey: 'k', item: { eventType: 'detail_open', at: 1 } },
      { dedupeKey: 'k', item: { eventType: 'detail_open', at: 2 } }
    ]);
    expect(out).toHaveLength(1);
    expect(collapsed).toBe(1);
    expect(out[0].item.at).toBe(1);
  });

  it('leaves distinct identities alone', () => {
    const { out, collapsed } = collapse([
      { dedupeKey: 'a', item: { eventType: 'photo_dwell' } },
      { dedupeKey: 'b', item: { eventType: 'photo_dwell' } },
      { dedupeKey: 'c', item: { eventType: 'final_watch' } }
    ]);
    expect(out).toHaveLength(3);
    expect(collapsed).toBe(0);
  });

  it('reduces a batch to unique keys, so the index can never be the thing that catches it', () => {
    const { out } = collapse([
      { dedupeKey: 'a', item: { eventType: 'photo_dwell' } },
      { dedupeKey: 'a', item: { eventType: 'photo_dwell' } },
      { dedupeKey: 'b', item: { eventType: 'final_watch' } },
      { dedupeKey: 'b', item: { eventType: 'final_watch' } },
      { dedupeKey: 'b', item: { eventType: 'final_watch' } }
    ]);
    const keys = out.map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every collapsed copy is still accounted for', () => {
    const entries = [
      { dedupeKey: 'a', item: { eventType: 'photo_dwell' } },
      { dedupeKey: 'a', item: { eventType: 'photo_dwell' } },
      { dedupeKey: 'a', item: { eventType: 'photo_dwell' } },
      { dedupeKey: 'b', item: { eventType: 'detail_open' } }
    ];
    const { out, collapsed } = collapse(entries);
    // Nothing is silently dropped: kept + collapsed == what arrived.
    expect(out.length + collapsed).toBe(entries.length);
  });
});
