import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * Signing out, now that there is no logout page.
 *
 * The old flow was `window.location.href = '/auth/logout'`: a full reload onto a
 * page whose `useEffect` did the sign-out and then showed a confirmation screen.
 * That page is deleted, so what these tests pin is that the replacement does the
 * same *real* work — a server-side revoke, not a cookie wipe — and none of the
 * things the page got wrong: an extra history entry, a hard reload, and a URL
 * where a GET performed a state change.
 */

const performLogout = jest.fn();
const showErrorMessage = jest.fn();
jest.mock('@lib/utils', () => ({
  performLogout: (...args: any[]) => performLogout(...args),
  showErrorMessage: (...args: any[]) => showErrorMessage(...args)
}));

const replace = jest.fn();
const push = jest.fn();
const refresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, refresh })
}));

import { useLogout } from './use-logout';

beforeEach(() => {
  performLogout.mockReset().mockResolvedValue(undefined);
  showErrorMessage.mockReset();
  replace.mockReset();
  push.mockReset();
  refresh.mockReset();
});

describe('a successful sign-out', () => {
  it('revokes the session exactly once', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    // `performLogout` is NextAuth's `signOut`, which fires the `signOut` event in
    // `auth-options.ts` and revokes the token on the API. Not a cookie wipe.
    expect(performLogout).toHaveBeenCalledTimes(1);
  });

  it('lands on the home page with replace, not push', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    expect(replace).toHaveBeenCalledWith('/');
    // `push` would leave the protected page in history for Back to return to.
    expect(push).not.toHaveBeenCalled();
  });

  it('never navigates to the retired logout page', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    const destinations = [...replace.mock.calls, ...push.mock.calls].flat();
    expect(destinations).not.toContain('/auth/logout');
    expect(destinations.join(' ')).not.toContain('/auth/');
  });

  it('refreshes the server tree so the UI comes back signed out', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    // Without this the header and every server-rendered surface would still be
    // holding the signed-in render, and the RSC cache would keep private data.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('revokes before it navigates', async () => {
    const order: string[] = [];
    performLogout.mockImplementation(async () => { order.push('revoke'); });
    replace.mockImplementation(() => { order.push('replace'); });
    refresh.mockImplementation(() => { order.push('refresh'); });

    const { result } = renderHook(() => useLogout());
    await act(async () => { await result.current.logout(); });

    // Navigating first would show a signed-out page while the session was still
    // live on the server.
    expect(order).toEqual(['revoke', 'replace', 'refresh']);
  });
});

describe('double submission', () => {
  it('does not revoke twice when clicked twice in the same tick', async () => {
    let release: () => void = () => { };
    performLogout.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));

    const { result } = renderHook(() => useLogout());

    await act(async () => {
      void result.current.logout();
      void result.current.logout();
      void result.current.logout();
    });

    // A ref guard, not the `loggingOut` state: a second click can arrive before
    // React has re-rendered with the button disabled.
    expect(performLogout).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('reports itself busy while in flight', async () => {
    let release: () => void = () => { };
    performLogout.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));

    const { result } = renderHook(() => useLogout());

    await act(async () => { void result.current.logout(); });
    expect(result.current.loggingOut).toBe(true);

    await act(async () => { release(); });
    await waitFor(() => expect(result.current.loggingOut).toBe(false));
  });

  it('allows a fresh attempt after the first one settles', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });
    await act(async () => { await result.current.logout(); });

    expect(performLogout).toHaveBeenCalledTimes(2);
  });
});

describe('when the revoke fails', () => {
  beforeEach(() => {
    performLogout.mockRejectedValue(new Error('revoke failed'));
  });

  it('does not claim success by navigating away', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    // Showing a signed-out page while the session is still live on the server is
    // the one outcome worse than an error message.
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces the failure through the existing error handling', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it('lets the user try again', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });
    expect(result.current.loggingOut).toBe(false);

    performLogout.mockResolvedValue(undefined);
    await act(async () => { await result.current.logout(); });

    expect(replace).toHaveBeenCalledWith('/');
  });
});

describe('signing out from a protected route', () => {
  it('lands on a public route, so no guard reopens the dialog', async () => {
    // `/friend`, `/following`, `/messages` and the creator pages all render
    // `AuthRequiredGate` when signed out. Going to `/` rather than staying put
    // is what stops the login dialog appearing the instant the user logs out.
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    expect(replace).toHaveBeenCalledWith('/');
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
