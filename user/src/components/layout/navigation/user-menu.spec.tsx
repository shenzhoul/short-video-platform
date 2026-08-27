import { act, render, screen } from '@testing-library/react';
import React from 'react';

/**
 * The left navigation's auth behaviour.
 *
 * Two of these entries build their destination from the signed-in user, and the
 * Profile one used to interpolate `undefined` into its href when there was no
 * user — producing the literal path `/undefined`, which resolves to the
 * `[creator]` route, finds no such creator and renders a hard 404. An
 * authentication problem wearing a not-found error.
 *
 * `/following` and `/friend` are different and deliberately still navigate: they
 * are fixed URLs, so the page itself can gate and the URL the visitor asked for
 * survives the sign-in. Only an href that cannot be *built* is intercepted here.
 */

const push = jest.fn();
let pathname = '/';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push })
}));

const openAuthModal = jest.fn();
jest.mock('@providers/auth-modal.provider', () => ({
  useAuthModal: () => ({ openAuthModal })
}));

let currentUser: any = null;
let fetching = false;
jest.mock('@providers/profile.provider', () => ({
  useProfile: () => ({ current: currentUser, fetching })
}));

jest.mock('@hooks/use-mobile', () => ({ useIsMobile: () => false }));

// The menu only reads `theme` to pick an icon file name; a real provider would
// pull the whole theming stack into a spec about navigation.
jest.mock('@providers/ThemeProvider', () => ({
  ThemeContext: { Provider: ({ children }: any) => children, _currentValue: { theme: 'light' } }
}));

import { DashboardMenu } from './user-menu';

function renderMenu() {
  return render(<DashboardMenu onLogout={jest.fn()} />);
}

/** The rendered anchor/button for a menu entry, addressed by its label. */
const entry = (label: string) => screen.getByLabelText(label);

beforeEach(() => {
  push.mockReset();
  openAuthModal.mockReset();
  pathname = '/';
  currentUser = null;
  fetching = false;
});

describe('signed out', () => {
  it('never produces a /undefined destination', () => {
    const { container } = renderMenu();

    // The bug in its most direct form: no href, anywhere, containing the string
    // "undefined".
    expect(container.innerHTML).not.toContain('/undefined');
    expect(container.innerHTML).not.toContain('undefined');
  });

  it('opens the auth dialog when Profile is clicked', () => {
    renderMenu();

    act(() => { entry('Profile').click(); });

    expect(openAuthModal).toHaveBeenCalledTimes(1);
  });

  it('does not navigate anywhere when Profile is clicked', () => {
    renderMenu();

    act(() => { entry('Profile').click(); });

    // Not to `/undefined`, not to `/auth/login`, not anywhere.
    expect(push).not.toHaveBeenCalled();
  });

  it('still navigates for Following and Friends, whose URLs are fixed', () => {
    renderMenu();

    act(() => { entry('Following').click(); });
    expect(push).toHaveBeenCalledWith('/following');

    act(() => { entry('Friends').click(); });
    expect(push).toHaveBeenCalledWith('/friend');

    // Those pages gate themselves, which preserves the intended URL — better
    // than intercepting the click, because signing in lands back on the page.
    expect(openAuthModal).not.toHaveBeenCalled();
  });
});

describe('signed in', () => {
  beforeEach(() => {
    currentUser = { _id: 'u1', username: 'ada' };
  });

  it('sends Profile to the current user profile', () => {
    renderMenu();

    act(() => { entry('Profile').click(); });

    expect(push).toHaveBeenCalledWith('/ada');
    expect(openAuthModal).not.toHaveBeenCalled();
  });

  it('still navigates for Following and Friends', () => {
    renderMenu();

    act(() => { entry('Following').click(); });
    act(() => { entry('Friends').click(); });

    expect(push).toHaveBeenCalledWith('/following');
    expect(push).toHaveBeenCalledWith('/friend');
  });
});

describe('while the profile is still hydrating', () => {
  it('does not navigate to a half-built profile URL', () => {
    // `fetching` true with no user yet is the window the old code interpolated
    // `undefined` in.
    fetching = true;
    currentUser = null;
    renderMenu();

    act(() => { entry('Profile').click(); });

    expect(push).not.toHaveBeenCalled();
    expect(openAuthModal).toHaveBeenCalledTimes(1);
  });

  it('navigates once the username has arrived', () => {
    fetching = false;
    currentUser = { _id: 'u1', username: 'ada' };
    renderMenu();

    act(() => { entry('Profile').click(); });

    expect(push).toHaveBeenCalledWith('/ada');
  });
});
