import { navigationContextMoves, resolveNavigationContext } from './post-navigation-context';

/**
 * The navigation state matrix, asserted exhaustively.
 *
 * There is exactly one resolver and every input reads it — the wheel, the
 * trackpad, touch swipe, the arrow keys, the up/down capsule and the popup's
 * next/previous. These cases are the contract those inputs share, so a change
 * that only "fixes" one surface fails here.
 */
describe('resolveNavigationContext', () => {
  describe('no panel open', () => {
    it('navigates the recommendation order', () => {
      expect(resolveNavigationContext({ panelTab: null, source: 'for-you' })).toBe('recommendation');
    });

    it('navigates the recommendation order with no source named at all', () => {
      expect(resolveNavigationContext({ panelTab: null })).toBe('recommendation');
    });
  });

  describe('Videos tab open', () => {
    it('is creator-scoped, matching what the popup next/previous walks', () => {
      expect(resolveNavigationContext({ panelTab: 'videos', source: 'for-you' })).toBe('creator');
    });

    it('is creator-scoped from every surface that can open it', () => {
      (['home-feed', 'for-you', 'following-feed', 'search', 'direct-link'] as const).forEach((source) => {
        expect(resolveNavigationContext({ panelTab: 'videos', source })).toBe('creator');
      });
    });
  });

  describe('a creator-scoped source', () => {
    it('is creator-scoped even with the panel closed', () => {
      expect(resolveNavigationContext({ panelTab: null, source: 'profile-videos' })).toBe('creator');
      expect(resolveNavigationContext({ panelTab: null, source: 'creator-videos-tab' })).toBe('creator');
    });

    it('stays creator-scoped under a non-navigating tab, because the list has not changed', () => {
      expect(resolveNavigationContext({ panelTab: 'comments', source: 'profile-videos' })).toBe('creator');
    });
  });

  describe('any other tab open', () => {
    it.each(['details', 'comments', 'related', 'ask-ai'])('disables navigation for the %s tab', (tab) => {
      expect(resolveNavigationContext({ panelTab: tab, source: 'for-you' })).toBe('disabled');
    });
  });

  describe('Messages open', () => {
    it('disables navigation with the panel closed', () => {
      expect(resolveNavigationContext({ panelTab: null, source: 'for-you', messagesOpen: true })).toBe('disabled');
    });

    it('outranks the creator grid', () => {
      expect(resolveNavigationContext({ panelTab: 'videos', source: 'for-you', messagesOpen: true })).toBe('disabled');
    });
  });

  describe('an active input, scroller or seek gesture', () => {
    it('disables navigation in recommendation context', () => {
      expect(resolveNavigationContext({ panelTab: null, source: 'for-you', inputActive: true })).toBe('disabled');
    });

    it('outranks creator context — a scrub must not change the post', () => {
      expect(resolveNavigationContext({ panelTab: 'videos', source: 'for-you', inputActive: true })).toBe('disabled');
    });

    it('outranks a creator-scoped source too', () => {
      expect(resolveNavigationContext({ panelTab: null, source: 'profile-videos', inputActive: true })).toBe('disabled');
    });
  });

  describe('navigationContextMoves', () => {
    it('is true for both sequence-owning contexts and false for disabled', () => {
      expect(navigationContextMoves('recommendation')).toBe(true);
      expect(navigationContextMoves('creator')).toBe(true);
      expect(navigationContextMoves('disabled')).toBe(false);
    });
  });

  describe('the full matrix, as one table', () => {
    const rows: Array<[string, Parameters<typeof resolveNavigationContext>[0], string]> = [
      ['no panel', { panelTab: null, source: 'for-you' }, 'recommendation'],
      ['videos tab', { panelTab: 'videos', source: 'for-you' }, 'creator'],
      ['details tab', { panelTab: 'details', source: 'for-you' }, 'disabled'],
      ['comments tab', { panelTab: 'comments', source: 'for-you' }, 'disabled'],
      ['related tab', { panelTab: 'related', source: 'for-you' }, 'disabled'],
      ['ask-ai tab', { panelTab: 'ask-ai', source: 'for-you' }, 'disabled'],
      ['messages open', { panelTab: null, source: 'for-you', messagesOpen: true }, 'disabled'],
      ['seek held', { panelTab: null, source: 'for-you', inputActive: true }, 'disabled'],
      ['seek held on videos tab', { panelTab: 'videos', source: 'for-you', inputActive: true }, 'disabled']
    ];

    it.each(rows)('%s -> %s', (_label, input, expected) => {
      expect(resolveNavigationContext(input)).toBe(expected);
    });
  });
});
