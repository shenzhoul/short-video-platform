/**
 * The showcase account's partner selection must depend only on the plan.
 *
 * `seedPrimaryShowcase` builds the primary account's three example threads --
 * one pending, one restricted, one blocked -- and it must not reuse a partner
 * the ring or the chords already paired the primary with, or a showcase state
 * lands on a thread that already holds ordinary messages.
 *
 * It used to answer that question by reading the conversations already in the
 * database. That worked exactly once. On a second seed its own three threads
 * counted as "taken", so it chose three *different* partners and created three
 * more conversations, six more participant rows, four more messages and two
 * more block/restrict rows. `demo:seed` is supposed to be idempotent, and the
 * only thing that caught it was comparing the summary counts by hand.
 *
 * These tests fix the property that prevents it: the exclusion set is derived
 * from the plan's account order, so it is identical on every run regardless of
 * what is already stored.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { ringAndChordPartnersOf } = require('./seed-social');

const accountsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ username: `user${i}` }));

describe('showcase partner selection', () => {
  it('excludes both ring neighbours and both chord partners', () => {
    const accounts = accountsOf(16);
    // stride = max(2, floor(16 / 3)) = 5, matching seedConversations.
    const partners = ringAndChordPartnersOf(accounts, 'user0');

    expect(partners).toEqual(new Set(['user1', 'user15', 'user5', 'user11']));
  });

  it('is a pure function of the plan, so it never depends on what is stored', () => {
    const accounts = accountsOf(16);
    const first = ringAndChordPartnersOf(accounts, 'user3');
    const second = ringAndChordPartnersOf(accounts, 'user3');

    // The same answer on a second call is the whole point: a second `demo:seed`
    // must exclude exactly what the first excluded.
    expect([...second].sort()).toEqual([...first].sort());
  });

  it('leaves enough partners free for the three showcase threads', () => {
    const accounts = accountsOf(16);
    const partners = ringAndChordPartnersOf(accounts, 'user0');
    const available = accounts.filter((a) => a.username !== 'user0' && !partners.has(a.username));

    // The showcase needs three; anything less and states get silently skipped.
    expect(available.length).toBeGreaterThanOrEqual(3);
  });

  it('never returns the account itself, even when the ring wraps onto it', () => {
    // With three accounts the stride is 2, so `index - stride` wraps back round
    // to the account itself; it must not exclude itself from its own partners.
    const partners = ringAndChordPartnersOf(accountsOf(3), 'user0');

    expect(partners.has('user0')).toBe(false);
  });

  it('returns nothing for an account the plan does not contain', () => {
    expect(ringAndChordPartnersOf(accountsOf(16), 'nobody')).toEqual(new Set());
  });
});
