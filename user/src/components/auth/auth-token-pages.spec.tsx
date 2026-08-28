import {
  act, fireEvent, render, screen, waitFor
} from '@testing-library/react';
import React from 'react';

/**
 * The two public pages reached from a link in an email, plus the login pane's
 * unconfirmed-address state.
 *
 * The theme throughout is that **nothing here may require a session**. Whoever
 * follows one of these links has either not confirmed their address or has
 * forgotten their password, so any screen that asks them to sign in first is a
 * dead end.
 */

const searchParams = { value: new URLSearchParams() };
jest.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.value
}));

const openAuthModal = jest.fn();
jest.mock('@providers/auth-modal.provider', () => ({
  useAuthModal: () => ({ openAuthModal, closeAuthModal: jest.fn(), setMode: jest.fn() })
}));

const verifyEmail = jest.fn();
const resendVerification = jest.fn().mockResolvedValue({});
const resetPassword = jest.fn();
jest.mock('@services/auth.service', () => ({
  verifyEmail: (...args: any[]) => verifyEmail(...args),
  resendVerification: (...args: any[]) => resendVerification(...args),
  resetPassword: (...args: any[]) => resetPassword(...args)
}));

jest.mock('@lib/crypto', () => ({
  hashPassword: async (value: string) => `hashed:${value}`
}));

// eslint-disable-next-line import/first
import ResetPasswordForm from './reset-password-form';
// eslint-disable-next-line import/first
import VerifyEmailPanel from './verify-email-panel';

beforeEach(() => {
  searchParams.value = new URLSearchParams();
  openAuthModal.mockClear();
  verifyEmail.mockReset().mockResolvedValue({ data: { verified: true, alreadyVerified: false } });
  resendVerification.mockClear().mockResolvedValue({});
  resetPassword.mockReset().mockResolvedValue({ data: { reset: true } });
});

describe('the email confirmation page', () => {
  it('posts the token from the URL rather than following a link that mutates', async () => {
    searchParams.value = new URLSearchParams('token=abc123');

    await act(async () => { render(<VerifyEmailPanel />); });

    // The link in the email is a GET to this page; the page does the mutating.
    // A GET that consumed the token would be spent by Gmail's own link scanner
    // before the recipient ever clicked.
    expect(verifyEmail).toHaveBeenCalledWith('abc123');
  });

  it('sends the token exactly once, even under StrictMode double-invocation', async () => {
    searchParams.value = new URLSearchParams('token=abc123');

    await act(async () => {
      render(
        <React.StrictMode>
          <VerifyEmailPanel />
        </React.StrictMode>
      );
    });

    // Without the ref guard the second effect run consumes a token the first
    // already spent, turning every confirmation in development into an error.
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });

  it('reports success and offers the login dialog, never a login route', async () => {
    searchParams.value = new URLSearchParams('token=abc123');

    await act(async () => { render(<VerifyEmailPanel />); });

    expect(await screen.findByText('Email confirmed')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log in' })); });
    expect(openAuthModal).toHaveBeenCalledWith({ mode: 'login' });
  });

  it('treats an already-confirmed account as success, not an error', async () => {
    searchParams.value = new URLSearchParams('token=abc123');
    verifyEmail.mockResolvedValue({ data: { verified: true, alreadyVerified: true } });

    await act(async () => { render(<VerifyEmailPanel />); });

    // From the visitor's side it is the same good news either way.
    expect(await screen.findByText('Email confirmed')).toBeInTheDocument();
  });

  it('offers a fresh link when the token is spent or expired', async () => {
    searchParams.value = new URLSearchParams('token=stale');
    verifyEmail.mockRejectedValue({ statusCode: 400, error: 'VERIFICATION_TOKEN_INVALID', message: 'no longer valid' });

    await act(async () => { render(<VerifyEmailPanel />); });

    expect(await screen.findByText('This link no longer works')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeInTheDocument();
  });

  it('does not call the API at all when the URL carries no token', async () => {
    await act(async () => { render(<VerifyEmailPanel />); });

    expect(verifyEmail).not.toHaveBeenCalled();
    expect(await screen.findByText('This link no longer works')).toBeInTheDocument();
  });

  it('never opens the login dialog before it has handled the token', async () => {
    searchParams.value = new URLSearchParams('token=abc123');

    await act(async () => { render(<VerifyEmailPanel />); });

    // Confirming an address is something a visitor is entitled to do without an
    // account. A login form over the result would be asking them to sign in to
    // read an answer about the account they cannot sign in to yet.
    expect(openAuthModal).not.toHaveBeenCalled();
  });

  it('asks for an identifier before resending, because the API will not name the account', async () => {
    searchParams.value = new URLSearchParams('token=stale');
    verifyEmail.mockRejectedValue({ statusCode: 400, error: 'VERIFICATION_TOKEN_INVALID', message: 'no longer valid' });

    await act(async () => { render(<VerifyEmailPanel />); });
    const input = await screen.findByLabelText('Email or username');

    fireEvent.change(input, { target: { value: 'visitor@example.com' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send a new link' })); });

    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith('visitor@example.com'));
  });
});

describe('the password reset page', () => {
  function submit() {
    return act(async () => { fireEvent.submit(document.querySelector('form')!); });
  }

  function fill(password: string, confirm = password) {
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  }

  it('refuses to render a form with no token in the URL', async () => {
    render(<ResetPasswordForm />);

    expect(screen.getByText('This link no longer works')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
  });

  it('hashes the password before it leaves the browser', async () => {
    searchParams.value = new URLSearchParams('token=abc123');
    render(<ResetPasswordForm />);

    fill('correcthorse');
    await submit();

    // The API stores a salted scrypt hash of *this digest*, exactly as login and
    // registration send it. Sending the plaintext would store a hash of the
    // wrong input and the new password would simply not work.
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('abc123', 'hashed:correcthorse'));
  });

  it('reports success without signing anybody in', async () => {
    searchParams.value = new URLSearchParams('token=abc123');
    render(<ResetPasswordForm />);

    fill('correcthorse');
    await submit();

    expect(await screen.findByText('Password updated')).toBeInTheDocument();
    // Resetting a password is not signing in, and there is one place in this
    // application that issues a session.
    expect(openAuthModal).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log in' })); });
    expect(openAuthModal).toHaveBeenCalledWith({ mode: 'login' });
  });

  it('replaces the form when the link is spent', async () => {
    searchParams.value = new URLSearchParams('token=stale');
    // The shape `APIRequest` really throws: the response *body*, not an axios
    // error. Asserting against the axios shape is what let the real bug through.
    resetPassword.mockRejectedValue({ statusCode: 400, error: 'RESET_TOKEN_INVALID', message: 'no longer valid' });
    render(<ResetPasswordForm />);

    fill('correcthorse');
    await submit();

    expect(await screen.findByText('This link no longer works')).toBeInTheDocument();
    // The token cannot be reused, so leaving the form up would invite a second
    // attempt that is guaranteed to fail.
    expect(document.querySelector('form')).toBeNull();
    expect(screen.getByText(/password has not been changed/i)).toBeInTheDocument();
  });

  it('keeps the form up for a failure the visitor can retry', async () => {
    searchParams.value = new URLSearchParams('token=abc123');
    resetPassword.mockRejectedValue(new Error('network'));
    render(<ResetPasswordForm />);

    fill('correcthorse');
    await submit();

    expect(await screen.findByText('Could not reach the server. Please try again.')).toBeInTheDocument();
    expect(document.querySelector('form')).not.toBeNull();
  });

  it('keeps the form up for a rate limit, which leaves the link usable', async () => {
    searchParams.value = new URLSearchParams('token=abc123');
    resetPassword.mockRejectedValue({ statusCode: 429, message: 'slow down' });
    render(<ResetPasswordForm />);

    fill('correcthorse');
    await submit();

    // A 429 did not consume the token, so replacing the form would strand a
    // link that still works.
    expect(await screen.findByText('Could not reach the server. Please try again.')).toBeInTheDocument();
    expect(document.querySelector('form')).not.toBeNull();
  });

  it('refuses mismatched passwords before contacting the API', async () => {
    searchParams.value = new URLSearchParams('token=abc123');
    render(<ResetPasswordForm />);

    fill('correcthorse', 'somethingelse');
    await submit();

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
