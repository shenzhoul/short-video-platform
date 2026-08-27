import React from 'react';

/**
 * The server side of the auth gate: which pages fetch private data, and when.
 *
 * The dialog's own behaviour is covered in
 * `src/providers/auth-modal.provider.spec.tsx`. What is proved here is the half
 * that runs before any of that — that a signed-out request never reaches a
 * private loader, and never turns "you are not signed in" into "this page does
 * not exist".
 *
 * These are async server components, so they are invoked directly and their
 * returned element is inspected. That is the only way to assert the thing that
 * matters most: the loaders are not called at all.
 */

const notFound = jest.fn(() => {
  // Mirrors Next: `notFound()` throws rather than returning, so a page that
  // calls it never reaches its own return statement.
  const error: any = new Error('NEXT_NOT_FOUND');
  error.digest = 'NEXT_NOT_FOUND';
  throw error;
});
jest.mock('next/navigation', () => ({ notFound: (...args: any[]) => notFound(...args) }));

const getServerAuth = jest.fn();
jest.mock('@lib/server-auth', () => ({ getServerAuth: () => getServerAuth() }));

jest.mock('@lib/ip', () => ({ getClientIpHeadersFromNextHeaders: async () => ({ 'X-Real-IP': '1.2.3.4' }) }));

const getFollowingPosts = jest.fn();
const getFriendPosts = jest.fn();
jest.mock('@services/post.service', () => ({
  getFollowingPosts: (...args: any[]) => getFollowingPosts(...args),
  getFriendPosts: (...args: any[]) => getFriendPosts(...args),
  getPersonalizedHomePosts: jest.fn()
}));

const getFollowingUsers = jest.fn();
const getFriendUsers = jest.fn();
jest.mock('@services/user.service', () => ({
  getFollowingUsers: (...args: any[]) => getFollowingUsers(...args),
  getFriendUsers: (...args: any[]) => getFriendUsers(...args)
}));

// The feed itself is a large client component with its own suite; stubbed so
// this spec stays about the gate.
jest.mock('@components/following/following-feed', () => ({
  __esModule: true,
  default: function FollowingFeedStub() { return null; }
}));

import AuthRequiredGate from './auth-required-gate';
// eslint-disable-next-line import/no-relative-packages
import FollowingPage from '../../app/(public)/(main)/following/page';
// eslint-disable-next-line import/no-relative-packages
import FriendPage from '../../app/(public)/(main)/friend/page';

/** Every private loader these pages could possibly call. */
const privateLoaders = [getFollowingPosts, getFollowingUsers, getFriendPosts, getFriendUsers];

beforeEach(() => {
  notFound.mockClear();
  getServerAuth.mockReset();
  privateLoaders.forEach((loader) => loader.mockReset());
});

describe('/following — signed out', () => {
  beforeEach(() => {
    getServerAuth.mockResolvedValue({ session: null, token: undefined, user: undefined });
  });

  it('renders the auth gate instead of the feed', async () => {
    const element: any = await FollowingPage();

    expect(element.type).toBe(AuthRequiredGate);
  });

  it('calls no private loader at all', async () => {
    await FollowingPage();

    // Not "returns nothing useful" — never asked. A signed-out render must not
    // put a request on the wire for somebody else's follow graph.
    privateLoaders.forEach((loader) => expect(loader).not.toHaveBeenCalled());
  });

  it('does not report the page as missing', async () => {
    await FollowingPage();

    // The old shape of this bug: no session, so no data, so "404". Being signed
    // out is a state the visitor can fix; a missing page is not.
    expect(notFound).not.toHaveBeenCalled();
  });

  it('sends no private data to the client', async () => {
    const element: any = await FollowingPage();

    // The gate takes no props, so there is nothing in the payload to leak.
    expect(element.props).toEqual({});
  });

  it('treats a session with no token as signed out', async () => {
    // A half-hydrated session is not a licence to fetch: the request would go
    // out unauthenticated and come back either empty or 401.
    getServerAuth.mockResolvedValue({ session: { user: { _id: 'u1' } }, token: undefined });

    const element: any = await FollowingPage();

    expect(element.type).toBe(AuthRequiredGate);
    privateLoaders.forEach((loader) => expect(loader).not.toHaveBeenCalled());
  });
});

describe('/following — signed in', () => {
  beforeEach(() => {
    getServerAuth.mockResolvedValue({
      session: { user: { _id: 'u1' } },
      token: 'token-123',
      user: { _id: 'u1' }
    });
  });

  it('loads the feed and renders it, exactly as before', async () => {
    getFollowingPosts.mockResolvedValue({ data: { data: [{ _id: 'p1' }], hasMore: false } });
    getFollowingUsers.mockResolvedValue({ data: { data: [{ _id: 'c1' }] } });

    const element: any = await FollowingPage();

    expect(getFollowingPosts).toHaveBeenCalledTimes(1);
    expect(getFollowingUsers).toHaveBeenCalledTimes(1);
    expect(element.type).not.toBe(AuthRequiredGate);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('forwards the session token to both loaders', async () => {
    getFollowingPosts.mockResolvedValue({ data: null });
    getFollowingUsers.mockResolvedValue({ data: null });

    await FollowingPage();

    [getFollowingPosts, getFollowingUsers].forEach((loader) => {
      expect(loader.mock.calls[0][1]).toEqual(expect.objectContaining({ Authorization: 'token-123' }));
    });
  });

  it('still renders when a loader fails, rather than 404ing', async () => {
    // A signed-in visitor whose feed request failed has a working account and a
    // real page; the empty feed is honest here in a way it never was signed out.
    getFollowingPosts.mockRejectedValue(new Error('upstream down'));
    getFollowingUsers.mockRejectedValue(new Error('upstream down'));

    const element: any = await FollowingPage();

    expect(element.type).not.toBe(AuthRequiredGate);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('never opens the dialog for a signed-in visitor', async () => {
    getFollowingPosts.mockResolvedValue({ data: null });
    getFollowingUsers.mockResolvedValue({ data: null });

    const element: any = await FollowingPage();

    // The gate is the only thing that opens it, and it is not rendered.
    expect(element.type).not.toBe(AuthRequiredGate);
  });
});

describe('/friend — signed out', () => {
  beforeEach(() => {
    getServerAuth.mockResolvedValue({ session: null, token: undefined, user: undefined });
  });

  it('renders the auth gate instead of the feed', async () => {
    const element: any = await FriendPage();

    expect(element.type).toBe(AuthRequiredGate);
  });

  it('does not report the page as missing', async () => {
    await FriendPage();

    // `/friend` used to have no route at all and returned a hard 404. It is a
    // real page now, and being signed out is not a missing page.
    expect(notFound).not.toHaveBeenCalled();
  });

  it('calls no private loader at all', async () => {
    await FriendPage();

    // A mutual-follow graph is nobody's business until there is a session to
    // compute it for.
    privateLoaders.forEach((loader) => expect(loader).not.toHaveBeenCalled());
  });

  it('sends no private data to the client', async () => {
    const element: any = await FriendPage();

    expect(element.props).toEqual({});
  });
});

describe('/friend — signed in', () => {
  beforeEach(() => {
    getServerAuth.mockResolvedValue({
      session: { user: { _id: 'u1' } }, token: 'token-123', user: { _id: 'u1' }
    });
  });

  it('loads friends and their posts, and renders the feed', async () => {
    getFriendPosts.mockResolvedValue({ data: { data: [{ _id: 'p1' }], hasMore: false } });
    getFriendUsers.mockResolvedValue({ data: { data: [{ _id: 'f1' }] } });

    const element: any = await FriendPage();

    expect(getFriendPosts).toHaveBeenCalledTimes(1);
    expect(getFriendUsers).toHaveBeenCalledTimes(1);
    expect(element.type).not.toBe(AuthRequiredGate);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('scopes the feed to friends rather than to everyone followed', async () => {
    getFriendPosts.mockResolvedValue({ data: null });
    getFriendUsers.mockResolvedValue({ data: null });

    await FriendPage();

    // The following endpoints must not be what backs this page, or "friends"
    // would silently mean "everyone I follow".
    expect(getFollowingPosts).not.toHaveBeenCalled();
    expect(getFollowingUsers).not.toHaveBeenCalled();
  });

  it('renders an empty state rather than a 404 when there are no friends', async () => {
    getFriendPosts.mockResolvedValue({ data: { data: [], hasMore: false } });
    getFriendUsers.mockResolvedValue({ data: { data: [] } });

    const element: any = await FriendPage();

    // Having no friends yet is a legitimate state of a working account.
    expect(notFound).not.toHaveBeenCalled();
    expect(element.type).not.toBe(AuthRequiredGate);
  });

  it('still renders when a loader fails, rather than 404ing', async () => {
    getFriendPosts.mockRejectedValue(new Error('upstream down'));
    getFriendUsers.mockRejectedValue(new Error('upstream down'));

    const element: any = await FriendPage();

    expect(element.type).not.toBe(AuthRequiredGate);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('forwards the session token to both loaders', async () => {
    getFriendPosts.mockResolvedValue({ data: null });
    getFriendUsers.mockResolvedValue({ data: null });

    await FriendPage();

    [getFriendPosts, getFriendUsers].forEach((loader) => {
      expect(loader.mock.calls[0][1]).toEqual(expect.objectContaining({ Authorization: 'token-123' }));
    });
  });
});

describe('page metadata is safe to render signed out', () => {
  it.each([
    ['following', 'Following'],
    ['friend', 'Friends']
  ])('%s is neutral and touches no private data', async (route, title) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, import/no-dynamic-require
    const { metadata } = require(`../../app/(public)/(main)/${route}/page`);

    expect(metadata.title).toBe(title);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    // Static, so there is no `generateMetadata` that could fetch before the page
    // gets a chance to render the gate.
    expect(privateLoaders.every((loader) => loader.mock.calls.length === 0)).toBe(true);
  });
});
