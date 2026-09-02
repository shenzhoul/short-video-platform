/**
 * The creator-list cursor: parsing it, and paging with it.
 *
 * Two defects are locked down here, and both only bit once the dataset actually
 * contained pinned posts:
 *
 * 1. `lastIsPinned` was **always true**. The global pipe runs with
 *    `enableImplicitConversion: true`, so class-transformer coerced the query
 *    string to the property's reflected type before the custom `@Transform` saw
 *    it -- and `Boolean('false')` is `true`. Every page then took the "still
 *    inside the pinned block" branch, whose second arm matches every unpinned
 *    post with no `createdAt` bound, so each page returned the same rows and
 *    `hasMore` never went false. Paging a 10-post creator produced 32 rows
 *    containing 6 distinct posts, forever.
 *
 * 2. A cursor in the **timestamp form** answered 500. The payload advertises
 *    "ISO string, timestamp string, or number" and `applyCursorPagination`
 *    honours all three, but the creator path did a bare `new Date(value)` --
 *    and `new Date('1788064858000')` is an Invalid Date the driver refuses to
 *    serialise.
 */

import { plainToInstance } from 'class-transformer';
import { ObjectId } from 'mongodb';

import { PostSearchRequest } from './post-search.request';

/** Exactly how the global pipe in `main.ts` is configured. */
const fromQuery = (query: Record<string, unknown>) => plainToInstance(
  PostSearchRequest,
  query,
  { enableImplicitConversion: true }
);

describe('creator list cursor payload', () => {
  it('reads lastIsPinned=false as false under implicit conversion', () => {
    // Boolean('false') is true, so a transform reading the *converted* value
    // cannot tell the two apart. This is the whole bug.
    expect(fromQuery({ lastIsPinned: 'false' }).lastIsPinned).toBe(false);
  });

  it('reads lastIsPinned=true as true', () => {
    expect(fromQuery({ lastIsPinned: 'true' }).lastIsPinned).toBe(true);
  });

  it('leaves lastIsPinned undefined when the parameter is absent', () => {
    // Absent must stay absent: the service branches on `typeof !== 'boolean'`
    // to fall back to the plain cursor for older clients.
    expect(fromQuery({ cursor: 'x' }).lastIsPinned).toBeUndefined();
  });

  it('does not treat an arbitrary string as true', () => {
    expect(fromQuery({ lastIsPinned: 'no' }).lastIsPinned).toBe(false);
    expect(fromQuery({ lastIsPinned: '0' }).lastIsPinned).toBe(false);
  });

  it('accepts a real boolean unchanged', () => {
    expect(fromQuery({ lastIsPinned: true }).lastIsPinned).toBe(true);
    expect(fromQuery({ lastIsPinned: false }).lastIsPinned).toBe(false);
  });
});

describe('creator list cursor date parsing', () => {
  /* eslint-disable @typescript-eslint/no-var-requires, global-require */
  const { parseDateFromCursor } = require('src/common/utils/pagination.util');

  const iso = '2026-08-30T04:40:58.000Z';
  const ms = Date.parse(iso);

  it('parses the ISO form', () => {
    expect(parseDateFromCursor(iso).toISOString()).toBe(iso);
  });

  it('parses the timestamp form, which a bare new Date() cannot', () => {
    // `new Date('1788064858000')` is an Invalid Date -- the 500.
    expect(Number.isNaN(new Date(String(ms)).getTime())).toBe(true);
    expect(parseDateFromCursor(String(ms)).getTime()).toBe(ms);
  });

  it('parses a numeric timestamp', () => {
    expect(parseDateFromCursor(ms).getTime()).toBe(ms);
  });

  it('never returns an Invalid Date, whatever it is handed', () => {
    // The query builder must not receive something the driver refuses to
    // serialise; the epoch is the documented last resort.
    expect(Number.isNaN(parseDateFromCursor('not a date' as any).getTime())).toBe(false);
  });
});

/**
 * The filter the creator list pages with.
 *
 * The bug was a missing bound, so the assertions are about bounds: what does
 * and does not constrain the unpinned posts.
 */
describe('creator list cursor filter', () => {
  /* eslint-disable @typescript-eslint/no-var-requires, global-require */
  const { applyCreatorPinnedCursor } = require('src/services/content/post/post-search.service');

  const base = { status: 'active', userId: 'creator-1' };
  const cursorId = new ObjectId().toString();
  const iso = '2026-08-30T04:40:58.000Z';

  /** Every `createdAt` bound the filter imposes, anywhere in the tree. */
  const createdAtBounds = (filter: any): any[] => {
    const found: any[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'createdAt') found.push(value);
        walk(value);
      }
    };
    walk(filter);
    return found;
  };

  it('bounds the page by createdAt once the cursor has left the pinned block', () => {
    const filter = applyCreatorPinnedCursor(base, {
      cursor: cursorId, lastCreatedAt: iso, lastIsPinned: false
    } as any);

    // Unpinned only, and strictly older than the cursor. Without the second
    // half every page returned the same rows.
    expect(JSON.stringify(filter)).toContain('"isPinned":{"$ne":true}');
    expect(createdAtBounds(filter).length).toBeGreaterThan(0);
    expect(JSON.stringify(createdAtBounds(filter))).toContain('$lt');
  });

  it('excludes the cursor item itself', () => {
    const filter = applyCreatorPinnedCursor(base, {
      cursor: cursorId, lastCreatedAt: iso, lastIsPinned: false
    } as any);

    // The tiebreaker arm keeps same-timestamp items with a smaller _id, which
    // is what stops an item being emitted twice when timestamps collide.
    expect(JSON.stringify(filter)).toContain('"$lt"');
    expect(JSON.stringify(filter)).toContain(cursorId);
  });

  it('keeps unpinned posts unbounded while the cursor is still among the pinned', () => {
    const filter = applyCreatorPinnedCursor(base, {
      cursor: cursorId, lastCreatedAt: iso, lastIsPinned: true, lastPinnedAt: iso
    } as any);

    // Correct here, and only here: pinned posts all sort ahead of unpinned ones,
    // so if the cursor is still pinned then no unpinned post has been emitted
    // yet and all of them are still to come.
    expect(JSON.stringify(filter)).toContain('"isPinned":{"$ne":true}');
    expect(JSON.stringify(filter)).toContain('pinnedAt');
  });

  it('falls back to the plain cursor when lastIsPinned is absent', () => {
    const filter = applyCreatorPinnedCursor(base, {
      cursor: cursorId, lastCreatedAt: iso
    } as any);

    // Older clients send no pinned state; they must still get a bounded page.
    expect(JSON.stringify(createdAtBounds(filter))).toContain('$lt');
  });

  it('accepts a timestamp cursor without producing an Invalid Date', () => {
    const ms = Date.parse(iso);
    const filter = applyCreatorPinnedCursor(base, {
      cursor: cursorId, lastCreatedAt: String(ms), lastIsPinned: false
    } as any);

    for (const bound of createdAtBounds(filter)) {
      const date = bound?.$lt ?? bound;
      if (date instanceof Date) expect(Number.isNaN(date.getTime())).toBe(false);
    }
    // And it lands on the same instant the ISO form does -- a 500 previously.
    expect(JSON.stringify(filter)).toContain(new Date(ms).toISOString());
  });
});
