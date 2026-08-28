import { renderResetPassword } from './reset-password.template';
import { renderVerifyEmail } from './verify-email.template';

/**
 * What the two transactional emails contain, and — more importantly — what they
 * must never contain.
 *
 * `SettingService._settingCache` is empty in a unit test, so `siteName()` falls
 * back to its default. That is deliberate: the templates must render correctly
 * before any setting has been seeded.
 */

const VERIFY_URL = 'https://douyin-clone.vercel.app/auth/verify-email?token=RAW-TOKEN-VALUE';
const RESET_URL = 'https://douyin-clone.vercel.app/auth/reset-password?token=RAW-TOKEN-VALUE';

const verify = () => renderVerifyEmail({
  to: 'visitor@example.com',
  name: 'Visitor',
  verifyUrl: VERIFY_URL,
  ttlMinutes: 1440
});

const reset = () => renderResetPassword({
  to: 'visitor@example.com',
  name: 'Visitor',
  resetUrl: RESET_URL,
  ttlMinutes: 60
});

describe('every message has both parts', () => {
  it.each([['verification', verify], ['reset', reset]])('%s carries html and text', (_name, render) => {
    const message = render();

    expect(message.html.length).toBeGreaterThan(200);
    // Not optional. A message with no plain-text alternative scores worse with
    // every spam filter that exists, and a text part costs one function.
    expect(message.text.length).toBeGreaterThan(50);
    expect(message.subject).toBeTruthy();
    expect(message.to).toBe('visitor@example.com');
  });

  it.each([
    ['verification', verify, VERIFY_URL],
    ['reset', reset, RESET_URL]
  ])('%s puts the action link in both parts', (_name, render, url) => {
    const message = (render as () => ReturnType<typeof verify>)();

    // Both, not just the html: a client that renders the text part must still
    // give the recipient something to click.
    expect(message.html).toContain(url as string);
    expect(message.text).toContain(url as string);
  });
});

describe('the verification email', () => {
  it('names the product and the expiry in words', () => {
    const message = verify();

    expect(message.subject).toContain('Douyin Clone');
    // "1440 minutes" is the same information and useless in a sentence.
    expect(message.html).toContain('24 hours');
    expect(message.text).toContain('24 hours');
  });

  it('tells an unintended recipient to ignore it', () => {
    // Anybody can type any address into a signup form, so this may reach
    // somebody who never asked. Ignoring it is the correct instruction: the
    // account cannot be used until the link is followed.
    expect(verify().text).toMatch(/did not create/i);
  });
});

describe('the reset email', () => {
  it('says plainly that nothing has changed yet', () => {
    const message = reset();

    // The whole security value of this email for somebody who did not request
    // it. Without the sentence, "reset your password" reads as "your password
    // was reset" and the recipient panics instead of ignoring it.
    expect(message.text).toMatch(/password has not been changed/i);
    expect(message.html).toMatch(/password has not been changed/i);
  });

  it('states the shorter lifetime', () => {
    expect(reset().text).toContain('1 hour');
  });
});

describe('what must never appear', () => {
  const both = [verify(), reset()];

  it('never contains a password', () => {
    both.forEach((message) => {
      expect(message.html).not.toMatch(/\bpassword is\b/i);
      expect(message.text).not.toMatch(/\bpassword is\b/i);
    });
  });

  it('never contains an internal identifier', () => {
    both.forEach((message) => {
      // No userId, no token id, no database key. A recipient who forwards this
      // should not be handing over anything about how the system is built.
      expect(message.html).not.toMatch(/[0-9a-f]{24}/i);
      expect(message.text).not.toMatch(/[0-9a-f]{24}/i);
    });
  });

  it('never prints the bare token outside the URL', () => {
    both.forEach((message) => {
      const withoutUrls = message.text.replace(/https?:\/\/\S+/g, '');
      expect(withoutUrls).not.toContain('RAW-TOKEN-VALUE');
    });
  });

  it('loads no remote asset', () => {
    both.forEach((message) => {
      // Remote images are blocked by default in most clients, so a message
      // whose meaning depends on one arrives broken. It is also a read receipt
      // the recipient did not agree to.
      expect(message.html).not.toMatch(/<img/i);
      expect(message.html).not.toMatch(/<link/i);
      expect(message.html).not.toMatch(/<script/i);
    });
  });
});

describe('escaping', () => {
  it('neutralises markup in a display name', () => {
    const message = renderVerifyEmail({
      to: 'visitor@example.com',
      name: '<img src=x onerror=alert(1)>',
      verifyUrl: VERIFY_URL,
      ttlMinutes: 1440
    });

    // A display name is user-controlled: somebody who signs up as this must not
    // get it rendered in a client that executes it.
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('&lt;img src=x');
  });

  it('neutralises a quote that would break out of an href', () => {
    const message = renderVerifyEmail({
      to: 'visitor@example.com',
      name: 'Visitor',
      verifyUrl: 'https://example.com/?t=1" onmouseover="alert(1)',
      ttlMinutes: 1440
    });

    expect(message.html).not.toContain('" onmouseover="');
    expect(message.html).toContain('&quot;');
  });

  it('copes with an empty name', () => {
    const message = renderVerifyEmail({
      to: 'visitor@example.com',
      name: '',
      verifyUrl: VERIFY_URL,
      ttlMinutes: 1440
    });

    expect(message.text.startsWith('Hi,')).toBe(true);
  });
});
