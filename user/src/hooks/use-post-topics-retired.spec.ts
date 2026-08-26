import { isTopicKeyRetired, type PostTopicsCatalogue } from './use-post-topics';

const catalogue = (keys: string[], loadedAt: number): PostTopicsCatalogue => ({
  topics: keys.map((key) => ({ key, label: key.toUpperCase() })),
  loadedAt
});

const LOADED = 1_700_000_000_000;

/**
 * The decision behind clearing a selected category the admin has disabled.
 *
 * The API answers an unknown or disabled `topicKey` with the unfiltered feed rather than an error,
 * so the client is the only thing that can tell the person their filter is gone. That makes false
 * positives expensive: clearing a valid selection because a request had not landed yet, or because
 * one failed, would silently drop the filter they chose.
 */
describe('isTopicKeyRetired', () => {
  it('is true once a successful load confirms the key is gone', () => {
    expect(isTopicKeyRetired('travel', catalogue(['food', 'music'], LOADED))).toBe(true);
  });

  it('is false while the key is still offered', () => {
    expect(isTopicKeyRetired('travel', catalogue(['travel', 'food'], LOADED))).toBe(false);
  });

  it('is false when nothing is selected', () => {
    expect(isTopicKeyRetired('', catalogue(['travel'], LOADED))).toBe(false);
  });

  it('is false before the catalogue has ever loaded, so first paint never drops a selection', () => {
    // An empty list with loadedAt 0 is ignorance, not an answer. Treating it as an answer would
    // clear the selection on every mount while the first request is still in flight.
    expect(isTopicKeyRetired('travel', catalogue([], 0))).toBe(false);
  });

  it('is false when a failed refetch left a stale list that still contains the key', () => {
    // The hook keeps the previous list and does not advance loadedAt on failure, so this is exactly
    // the state a transient network error produces.
    expect(isTopicKeyRetired('travel', catalogue(['travel', 'food'], LOADED))).toBe(false);
  });

  it('stays true across a later failed refetch, because the removal was already confirmed', () => {
    // Once a successful load has said the key is gone, a subsequent failure does not resurrect it:
    // the list and loadedAt are both unchanged from that successful load.
    const afterRemoval = catalogue(['food'], LOADED);
    expect(isTopicKeyRetired('travel', afterRemoval)).toBe(true);
    expect(isTopicKeyRetired('travel', afterRemoval)).toBe(true);
  });

  it('is false for an empty catalogue that loaded successfully but has no selection', () => {
    expect(isTopicKeyRetired('', catalogue([], LOADED))).toBe(false);
  });

  it('is true for a selection when every category has been disabled', () => {
    expect(isTopicKeyRetired('travel', catalogue([], LOADED))).toBe(true);
  });
});
