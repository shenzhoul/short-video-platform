import {
  act, fireEvent, render, screen, waitFor, within
} from '@testing-library/react';
import React from 'react';

import AuthRequiredGate from '../components/auth/auth-required-gate';
import { AuthModalProvider, useAuthModal } from './auth-modal.provider';

/**
 * The authentication dialog, and the one rule the whole change exists for:
 * **nothing ever navigates to `/auth/login`.**
 *
 * A guarded action opens the dialog over the page. A guarded route renders the
 * gate, which opens the same dialog over the URL the visitor asked for. Signing
 * in refreshes that route in place. Every assertion below is one of those
 * sentences, plus the failure modes that make a dialog worse than a page:
 * duplicate submissions, duplicate toasts, and a close button that traps the
 * visitor on an empty protected route.
 */

let sessionStatus: 'loading' | 'authenticated' | 'unauthenticated' = 'unauthenticated';
const signInMock = jest.fn();
jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: sessionStatus, data: null }),
  signIn: (...args: any[]) => signInMock(...args)
}));

let pathname = '/for-you';
let searchParams = new URLSearchParams();
const push = jest.fn();
const replace = jest.fn();
const resendVerification = jest.fn().mockResolvedValue({});
const forgotPassword = jest.fn().mockResolvedValue({});
const refresh = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
  useRouter: () => ({ push, replace, refresh })
}));

const toastError = jest.fn();
const toastSuccess = jest.fn();
const toastInfo = jest.fn();
jest.mock('@douyin-clone/shared-toast', () => ({
  toast: {
    error: (...args: any[]) => toastError(...args),
    success: (...args: any[]) => toastSuccess(...args),
    info: (...args: any[]) => toastInfo(...args)
  },
  normalizeErrorMessage: (error: any, fallback: string) => error?.message || fallback
}));

const registerAccount = jest.fn();
jest.mock('@services/auth.service', () => ({
  register: (...args: any[]) => registerAccount(...args),
  resendVerification: (...args: any[]) => resendVerification(...args),
  forgotPassword: (...args: any[]) => forgotPassword(...args)
}));

// jsdom has no `crypto.subtle`, and what the digest *is* does not matter here —
// only that the plain password never leaves the form.
jest.mock('@lib/crypto', () => ({
  hashPassword: jest.fn(async (value: string) => `hashed:${value}`)
}));

/** A gated action — a like, a follow — as every such control now behaves. */
function GatedAction() {
  const { openAuthModal } = useAuthModal();
  return (
    <button type="button" onClick={() => openAuthModal()}>Like</button>
  );
}

function renderWithProvider(children: React.ReactNode) {
  return render(<AuthModalProvider>{children}</AuthModalProvider>);
}

/** Every navigation call, so a test can assert on all of them at once. */
function navigationCalls() {
  return [...push.mock.calls, ...replace.mock.calls].flat();
}

async function fillLogin(username = 'someone', password = 'password123') {
  fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

beforeEach(() => {
  sessionStatus = 'unauthenticated';
  pathname = '/for-you';
  searchParams = new URLSearchParams();
  signInMock.mockReset();
  registerAccount.mockReset();
  push.mockReset();
  replace.mockReset();
  refresh.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  toastInfo.mockReset();
});

describe('guarded actions', () => {
  it('opens the dialog instead of navigating to a login page', async () => {
    renderWithProvider(<GatedAction />);

    act(() => { screen.getByText('Like').click(); });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(navigationCalls()).toHaveLength(0);
  });

  it('shows one dialog however many times the control is clicked', async () => {
    renderWithProvider(<GatedAction />);

    act(() => {
      screen.getByText('Like').click();
      screen.getByText('Like').click();
      screen.getByText('Like').click();
    });

    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
  });

  it('does nothing at all when the visitor is already signed in', () => {
    sessionStatus = 'authenticated';
    renderWithProvider(<GatedAction />);

    act(() => { screen.getByText('Like').click(); });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on the close button and leaves the page where it was', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    act(() => { screen.getByLabelText('Close').click(); });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // An action opened it, so there is a real page behind it — closing must not
    // move the visitor anywhere.
    expect(navigationCalls()).toHaveLength(0);
  });
});

describe('guarded routes', () => {
  it('waits for the session to resolve before deciding anything', () => {
    sessionStatus = 'loading';
    renderWithProvider(<AuthRequiredGate />);

    // Opening here would flash a login form at somebody who is signed in, on
    // every hard refresh of every protected page.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(navigationCalls()).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('opens the dialog once the session resolves to signed out', async () => {
    sessionStatus = 'loading';
    const { rerender } = renderWithProvider(<AuthRequiredGate />);

    sessionStatus = 'unauthenticated';
    rerender(<AuthModalProvider><AuthRequiredGate /></AuthModalProvider>);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // The requested URL is untouched — that is the whole point of the gate.
    expect(navigationCalls()).toHaveLength(0);
  });

  it('refreshes rather than prompting when the client already has a session', async () => {
    sessionStatus = 'authenticated';
    renderWithProvider(<AuthRequiredGate />);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refreshes at most once, so a server that still says no cannot loop', async () => {
    sessionStatus = 'authenticated';
    const { rerender } = renderWithProvider(<AuthRequiredGate />);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    rerender(<AuthModalProvider><AuthRequiredGate /></AuthModalProvider>);
    rerender(<AuthModalProvider><AuthRequiredGate /></AuthModalProvider>);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sends the visitor to a public route when they close it without signing in', async () => {
    renderWithProvider(<AuthRequiredGate />);
    await screen.findByRole('dialog');

    act(() => { screen.getByLabelText('Close').click(); });

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    // `replace`, never `push`: a pushed entry would let Back walk straight into
    // the protected route again and reopen the dialog for ever.
    expect(push).not.toHaveBeenCalled();
  });
});

describe('logging in', () => {
  it('closes the dialog and re-renders the route the visitor was on', async () => {
    signInMock.mockResolvedValue({ ok: true });
    const { rerender } = renderWithProvider(<AuthRequiredGate />);
    await screen.findByRole('dialog');

    await fillLogin();
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Log in' }).closest('form')!); });

    expect(signInMock).toHaveBeenCalledWith('credentials', {
      username: 'someone',
      // Hashed in the browser, exactly as the retired login page did.
      password: 'hashed:password123',
      redirect: false
    });

    sessionStatus = 'authenticated';
    rerender(<AuthModalProvider><AuthRequiredGate /></AuthModalProvider>);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The route is re-rendered in place; nothing navigates, and no full reload.
    expect(refresh).toHaveBeenCalled();
    expect(navigationCalls()).toHaveLength(0);
  });

  it('reports a wrong password as exactly one normalised toast', async () => {
    signInMock.mockResolvedValue({ ok: false, error: 'CredentialsSignin: user not found in database' });
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    await fillLogin();
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Log in' }).closest('form')!); });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      'Your username/email or password is incorrect',
      expect.objectContaining({ toastId: 'auth:login-failed' })
    );
    // The dialog stays open so the visitor can correct the password, and the
    // server's own wording never reaches the screen.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toastError.mock.calls[0][0]).not.toContain('database');
  });

  it('refuses a second submission while the first is in flight', async () => {
    let release: (value: any) => void = () => { };
    signInMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');
    await fillLogin();

    const submitForm = async () => {
      await act(async () => { fireEvent.submit(document.querySelector('form')!); });
    };

    await submitForm();
    await submitForm();
    await submitForm();

    // Three Enters, one request. Each extra one would burn an attempt against
    // the API's five-per-minute login limit.
    expect(signInMock).toHaveBeenCalledTimes(1);
    // And the control says so rather than only refusing silently.
    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeDisabled();

    await act(async () => { release({ ok: false }); });
  });

  it('does not report a failure that arrives after the dialog is gone', async () => {
    let release: (value: any) => void = () => { };
    signInMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');
    await fillLogin();
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });

    act(() => { screen.getByLabelText('Close').click(); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await act(async () => { release({ ok: false }); });

    // A toast for a form nobody is looking at is noise attached to no context.
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('an unconfirmed email address', () => {
  /**
   * The one login refusal that is not collapsed into the generic message.
   *
   * It is reachable *only* after the password has been verified — the API checks
   * the credential first and answers the ordinary invalid-credentials error for
   * a wrong password — so reaching it already proves the caller holds the
   * account. That is what makes it safe to be specific here.
   */
  async function loginWith(error: string | undefined, ok = false) {
    signInMock.mockResolvedValue({ ok, error });
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'visitor' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });
  }

  it('shows the confirm-your-email pane instead of the failure toast', async () => {
    await loginWith('EMAIL_VERIFICATION_REQUIRED');

    expect(await screen.findByText('Confirm your email address')).toBeInTheDocument();
    // Not a toast: "your email is not confirmed" is useless without the means
    // to do something about it, and the means is the button below.
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send the link again/i })).toBeInTheDocument();
  });

  it('resends using whatever identifier was typed, address or username', async () => {
    await loginWith('EMAIL_VERIFICATION_REQUIRED');
    await screen.findByText('Confirm your email address');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send the link again/i }));
    });

    expect(resendVerification).toHaveBeenCalledWith('visitor');
  });

  it('never claims a message was sent, because the API will not say', async () => {
    await loginWith('EMAIL_VERIFICATION_REQUIRED');
    await screen.findByText('Confirm your email address');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send the link again/i }));
    });

    // The endpoint answers the same 200 for a registered address, an
    // unregistered one and one inside its cooldown, so "sent!" would be a claim
    // the browser has no way to know is true.
    expect(await screen.findByText(/if that account still needs confirming/i)).toBeInTheDocument();
  });

  it('starts the cooldown so the button cannot be hammered', async () => {
    await loginWith('EMAIL_VERIFICATION_REQUIRED');
    await screen.findByText('Confirm your email address');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send the link again/i }));
    });

    expect(await screen.findByRole('button', { name: /send again in \d+s/i })).toBeDisabled();
  });

  it('leaves every other failure as the single generic toast', async () => {
    await loginWith('CredentialsSignin');

    // The API distinguishes "no such account" from "wrong password"; forwarding
    // that difference would tell an attacker which usernames exist.
    expect(toastError).toHaveBeenCalledWith(
      'Your username/email or password is incorrect',
      expect.anything()
    );
    expect(screen.queryByText('Confirm your email address')).toBeNull();
  });

  it('goes back to the form without reloading anything', async () => {
    await loginWith('EMAIL_VERIFICATION_REQUIRED');
    await screen.findByText('Confirm your email address');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back to log in' })); });

    expect(await screen.findByLabelText('Email or username')).toBeInTheDocument();
    expect(navigationCalls()).toHaveLength(0);
  });
});

describe('password recovery', () => {
  /**
   * This assertion is the inverse of the one it replaces.
   *
   * Until the reset flow existed, the dialog deliberately carried **no**
   * "Forgot password?" affordance, and this suite asserted its absence — a link
   * to a feature that answers 404 is worse than no link. `POST /auth/forgot-password`
   * and `POST /auth/reset-password` are now real, so the link is real too, and
   * the guard flips to making sure it stays.
   *
   * It is still a link to a *pane*, never to a URL: `/auth/forgot-password`
   * remains a retired route that the proxy redirects, and an `href` pointing at
   * it would be a dead end.
   */
  it('offers a recovery link now that the flow behind it exists', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: /forgot password/i })).toBeInTheDocument();
    // Not an anchor. The pane lives inside this dialog; the old URL is retired.
    expect(dialog.querySelector('a[href*="forgot"]')).toBeNull();
  });

  it('swaps to the recovery pane inside the same dialog', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    act(() => { screen.getByRole('button', { name: /forgot password/i }).click(); });

    expect(await screen.findByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
    // One dialog throughout, and no navigation: the URL the visitor was on is
    // still the URL they are on.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(replace).not.toHaveBeenCalled();
  });

  async function openForgot() {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');
    act(() => { screen.getByRole('button', { name: /forgot password/i }).click(); });
    await screen.findByRole('button', { name: 'Send reset link' });
  }

  async function submitForgot(email: string) {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });
  }

  it('never claims a message was sent', async () => {
    await openForgot();
    await submitForgot('someone@example.com');

    // The API answers the same 200 for a registered address and an unregistered
    // one, so "we sent it" is a claim the browser cannot make.
    expect(await screen.findByText(/has an account/i)).toBeInTheDocument();
  });

  it('reports a rate-limited address exactly like an accepted one', async () => {
    // The shape `APIRequest` really throws. Written against `error.response.status`
    // this branch never matched, and a limited address rendered "could not reach
    // the server" while an unlimited one rendered the generic copy — the limiter
    // is per address, so that difference is an enumeration signal.
    forgotPassword.mockRejectedValueOnce({ statusCode: 429, message: 'slow down' });

    await openForgot();
    await submitForgot('someone@example.com');

    expect(await screen.findByText(/has an account/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });

  it('shows the transport message only when nothing reached the API', async () => {
    forgotPassword.mockRejectedValueOnce(new Error('Network Error'));

    await openForgot();
    await submitForgot('someone@example.com');

    // Nothing reached the server, so there is no account information to leak.
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/has an account/i)).toBeNull();
  });

  it('comes back to the login pane', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');
    act(() => { screen.getByRole('button', { name: /forgot password/i }).click(); });
    await screen.findByRole('button', { name: 'Send reset link' });

    act(() => { screen.getByRole('button', { name: 'Log in' }).click(); });

    expect(await screen.findByLabelText('Email or username')).toBeInTheDocument();
  });
});

describe('switching between login and signup', () => {
  it('swaps panes inside the same dialog', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    act(() => { screen.getByRole('button', { name: 'Sign up' }).click(); });

    expect(await screen.findByRole('button', { name: 'Sign up', hidden: false })).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toBeInTheDocument();
    // One dialog throughout: the shell is not torn down and rebuilt.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    act(() => { screen.getByRole('button', { name: 'Log in' }).click(); });

    expect(await screen.findByLabelText('Email or username')).toBeInTheDocument();
    expect(screen.queryByLabelText('Display name')).toBeNull();
  });

  it('does not carry a typed password across the switch', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-value' } });
    act(() => { screen.getByRole('button', { name: 'Sign up' }).click(); });
    act(() => { screen.getByRole('button', { name: 'Log in' }).click(); });

    expect((await screen.findByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('clears a validation error left over from the other pane', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    // Submitting empty raises inline errors...
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });
    expect(await screen.findByText('Enter your email or username')).toBeInTheDocument();

    act(() => { screen.getByRole('button', { name: 'Sign up' }).click(); });
    act(() => { screen.getByRole('button', { name: 'Log in' }).click(); });

    // ...and coming back must not show them again for fields nobody has touched.
    expect(screen.queryByText('Enter your email or username')).toBeNull();
  });
});

describe('signing up', () => {
  async function fillSignup(overrides: Record<string, string> = {}) {
    const values: Record<string, string> = {
      'First name': 'Ada',
      'Last name': 'Lovelace',
      Username: 'adalove',
      'Display name': 'Ada',
      Email: 'ada@example.com',
      Password: 'password123',
      'Confirm password': 'password123',
      ...overrides
    };
    Object.entries(values).forEach(([label, value]) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    });
  }

  async function openSignup() {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');
    act(() => { screen.getByRole('button', { name: 'Sign up' }).click(); });
    await screen.findByLabelText('Display name');
  }

  it('creates the account and sends the visitor to their inbox', async () => {
    registerAccount.mockResolvedValue({
      data: { _id: 'u1', emailVerificationRequired: true, verificationEmailQueued: true }
    });

    await openSignup();
    await fillSignup();
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });

    expect(registerAccount).toHaveBeenCalledWith({
      email: 'ada@example.com',
      username: 'adalove',
      name: 'Ada',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'female',
      password: 'hashed:password123'
    });
    // No role, no status, no verified-email flag: the client does not get to
    // ask for any of them.
    expect(Object.keys(registerAccount.mock.calls[0][0])).not.toContain('status');
    expect(Object.keys(registerAccount.mock.calls[0][0])).not.toContain('isAdmin');

    // **No automatic sign-in.** The account is created unconfirmed and
    // `POST /auth/login` refuses it until the link is followed, so calling
    // `signIn` here would be a guaranteed failure dressed up as an error.
    expect(signInMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(screen.getByText(/ada@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send the link again/i })).toBeInTheDocument();
    // The dialog stays open on the same URL — nothing navigated.
    expect(navigationCalls()).toHaveLength(0);
  });

  it('says so plainly when the account exists but the email did not go out', async () => {
    registerAccount.mockResolvedValue({
      data: { _id: 'u1', emailVerificationRequired: true, verificationEmailQueued: false }
    });

    await openSignup();
    await fillSignup();
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });

    // "The account was not created" and "the account exists but its email has
    // not gone out" are different outcomes and must never be reported as each
    // other. The second one still shows Resend.
    expect(await screen.findByText('Your account is ready')).toBeInTheDocument();
    expect(screen.getByText(/could not send the confirmation email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send the link again/i })).toBeInTheDocument();
  });

  it('shows a taken email against the field rather than as a toast', async () => {
    registerAccount.mockRejectedValue({ message: 'That email address is already registered.' });

    await openSignup();
    await fillSignup();
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });

    expect(await screen.findByText('That email address is already registered.')).toBeInTheDocument();
    // One message in one place — a toast on top of an inline error is the same
    // problem reported twice.
    expect(toastError).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('refuses a second submission while the first is in flight', async () => {
    let release: (value: any) => void = () => { };
    registerAccount.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    await openSignup();
    await fillSignup();
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });

    // Two accounts, or a duplicate-email error for an account the visitor just
    // successfully created — both are worse than one refused click.
    expect(registerAccount).toHaveBeenCalledTimes(1);

    signInMock.mockResolvedValue({ ok: true });
    await act(async () => { release({ data: {} }); });
  });

  it('validates the same way the admin create-user form does', async () => {
    await openSignup();
    await fillSignup({ Username: 'has space', 'Confirm password': 'different' });
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });

    expect(await screen.findByText('Username must contain only alphanumeric characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(registerAccount).not.toHaveBeenCalled();
  });
});

describe('arriving at the retired login URL', () => {
  it('opens the dialog from the query parameter and then removes it', async () => {
    // What the middleware produces for `/auth/login`: the home page, plus a
    // marker. There is no login page left to render.
    pathname = '/';
    searchParams = new URLSearchParams('authModal=login');

    renderWithProvider(<div>home</div>);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Stripped with `replace`, so a refresh or a Back does not reopen it over a
    // page the visitor has since signed into.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps any other query parameters the page was carrying', async () => {
    pathname = '/search';
    searchParams = new URLSearchParams('q=cats&authModal=login');

    renderWithProvider(<div>search</div>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/search?q=cats'));
  });

  it('ignores an unrecognised value rather than guessing', async () => {
    pathname = '/';
    searchParams = new URLSearchParams('authModal=whatever');

    renderWithProvider(<div>home</div>);

    await waitFor(() => expect(replace).not.toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('dialog accessibility', () => {
  it('is a labelled modal dialog with the caret in the first field', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Log in to Douyin-Clone');

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Email or username')));
  });

  it('locks the page behind it while it is open', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    expect(document.body.style.overflow).toBe('hidden');

    act(() => { screen.getByLabelText('Close').click(); });
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  it('closes on Escape', async () => {
    renderWithProvider(<GatedAction />);
    act(() => { screen.getByText('Like').click(); });
    await screen.findByRole('dialog');

    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
