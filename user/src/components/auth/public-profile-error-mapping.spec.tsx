/**
 * The public creator profile, and the three failures it must keep apart.
 *
 * `401`, `403` and `404` mean different things and have different remedies, so
 * collapsing them into one branch — which this page used to do for everything
 * that was not a 403 or a 410 — tells a signed-in visitor with a stale token
 * that the person they were looking at has vanished.
 *
 * The profile itself stays **public**: a signed-out visitor sees it. Nothing
 * here gates the page; only the actions on it are gated, and those go through
 * the shared dialog.
 */

const notFound = jest.fn(() => {
  const error: any = new Error('NEXT_NOT_FOUND');
  error.digest = 'NEXT_NOT_FOUND';
  throw error;
});
jest.mock('next/navigation', () => ({ notFound: (...args: any[]) => notFound(...args) }));

const getServerAuth = jest.fn().mockResolvedValue({ session: null, token: undefined, user: undefined });
jest.mock('@lib/server-auth', () => ({ getServerAuth: () => getServerAuth() }));

jest.mock('@lib/ip', () => ({ getClientIpHeadersFromNextHeaders: async () => ({}) }));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const getCachedCreatorLookup = jest.fn();
jest.mock('@lib/server-cache', () => ({
  getCachedCreatorLookup: (...args: any[]) => getCachedCreatorLookup(...args)
}));

const findCreatorByUsername = jest.fn();
jest.mock('@services/creator.service', () => ({
  findCreatorByUsername: (...args: any[]) => findCreatorByUsername(...args)
}));

jest.mock('@services/post.service', () => ({
  getPersonalizedHomePosts: jest.fn().mockResolvedValue({ data: null })
}));

jest.mock('@components/creator/creator-profile-page', () => ({
  __esModule: true,
  default: function CreatorProfilePageStub() { return null; }
}));
jest.mock('@components/creator/account-unavailable-page', () => ({
  __esModule: true,
  default: function AccountUnavailableStub() { return null; }
}));
jest.mock('@components/error/access-forbidden-content', () => ({
  AccessForbiddenContent: function AccessForbiddenStub() { return null; }
}));

import AccountUnavailablePage from '@components/creator/account-unavailable-page';
import CreatorProfilePage from '@components/creator/creator-profile-page';
import { AccessForbiddenContent } from '@components/error/access-forbidden-content';

// eslint-disable-next-line import/no-relative-packages
import CreatorPage from '../../app/(public)/(main)/[creator]/page';

/** The error shape `api-request.ts` actually throws (the NestJS body). */
const apiError = (statusCode: number, message = 'nope') => ({ statusCode, message });

function renderProfile(username = 'someone') {
  return CreatorPage({
    params: Promise.resolve({ creator: username }),
    searchParams: Promise.resolve({})
  } as any);
}

beforeEach(() => {
  notFound.mockClear();
  getCachedCreatorLookup.mockReset();
  findCreatorByUsername.mockReset();
  getServerAuth.mockResolvedValue({ session: null, token: undefined, user: undefined });
});

describe('a public profile stays public', () => {
  it('renders for a signed-out visitor', async () => {
    getCachedCreatorLookup.mockResolvedValue({ status: 'found', creator: { _id: 'c1' } });
    findCreatorByUsername.mockResolvedValue({ data: { _id: 'c1', username: 'someone' } });

    const element: any = await renderProfile();

    expect(element.type).toBe(CreatorProfilePage);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('the three failures stay apart', () => {
  it('404 — a creator that genuinely does not exist is still a 404', async () => {
    getCachedCreatorLookup.mockResolvedValue({ status: 'not-found' });

    await expect(renderProfile('ghost')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('404 — a lookup that succeeds but returns nothing is still a 404', async () => {
    getCachedCreatorLookup.mockResolvedValue({ status: 'found', creator: { _id: 'c1' } });
    findCreatorByUsername.mockResolvedValue({ data: null });

    await expect(renderProfile()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('403 — a forbidden profile renders the forbidden view, not a 404', async () => {
    getCachedCreatorLookup.mockResolvedValue({ status: 'found', creator: { _id: 'c1' } });
    findCreatorByUsername.mockRejectedValue(apiError(403, 'You have been blocked by this model'));

    const element: any = await renderProfile();

    expect(element.type).toBe(AccessForbiddenContent);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('401 — a rejected credential is NOT reported as a missing creator', async () => {
    getCachedCreatorLookup.mockResolvedValue({ status: 'found', creator: { _id: 'c1' } });
    findCreatorByUsername.mockRejectedValue(apiError(401, 'Unauthorized'));

    // Rethrown for the error boundary, which ends the dead session. The one
    // thing it must never do is call notFound().
    await expect(renderProfile()).rejects.toMatchObject({ statusCode: 401 });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('401 raised by the cached lookup is not reported as missing either', async () => {
    getCachedCreatorLookup.mockRejectedValue(apiError(401, 'Unauthorized'));

    await expect(renderProfile()).rejects.toMatchObject({ statusCode: 401 });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('410 — a deleted account keeps its own view', async () => {
    getCachedCreatorLookup.mockResolvedValue({ status: 'gone' });

    const element: any = await renderProfile();

    expect(element.type).toBe(AccountUnavailablePage);
    expect(notFound).not.toHaveBeenCalled();
  });
});
