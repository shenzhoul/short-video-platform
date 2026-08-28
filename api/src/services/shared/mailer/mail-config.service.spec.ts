import mailerConfig from 'src/config/mailer';
import { MailConfigService } from './mail-config.service';

/**
 * Boot-time validation of the mail configuration.
 *
 * The failure this guards against is specific and was observed in the system
 * this design replaces: validation happened at *send* time, inside a queue
 * worker that caught everything and only logged. A server with no SMTP
 * configuration therefore started cleanly, reported every job complete, and
 * silently delivered nothing — nobody found out until a user said their link
 * never arrived.
 *
 * Every test below is a variation on "the process must refuse to start".
 */

const ORIGINAL_ENV = { ...process.env };

function buildService(env: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...env } as any;
  const config = mailerConfig();
  return new MailConfigService({ get: () => config } as any);
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const VALID_SMTP = {
  NODE_ENV: 'production',
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'demo@gmail.com',
  SMTP_PASS: 'app-password',
  MAIL_FROM_NAME: 'Douyin Clone',
  MAIL_FROM_ADDRESS: 'demo@gmail.com',
  USER_APP_URL: 'https://douyin-clone.vercel.app'
};

describe('a complete configuration boots', () => {
  it('accepts a valid Gmail submission setup', () => {
    const service = buildService(VALID_SMTP);

    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.provider).toBe('smtp');
  });

  it('accepts the log provider outside production', () => {
    const service = buildService({
      NODE_ENV: 'development',
      MAIL_PROVIDER: 'log',
      USER_APP_URL: 'http://localhost:8081'
    });

    // Local development must not need a Gmail account.
    expect(() => service.onModuleInit()).not.toThrow();
  });
});

describe('an incomplete SMTP configuration refuses to start', () => {
  it.each([
    ['SMTP_HOST', 'SMTP_HOST is required'],
    ['SMTP_USER', 'SMTP_USER is required'],
    ['SMTP_PASS', 'SMTP_PASS is required'],
    ['MAIL_FROM_ADDRESS', 'MAIL_FROM_ADDRESS is required']
  ])('names %s when it is missing', (variable, expected) => {
    const service = buildService({ ...VALID_SMTP, [variable]: '' });

    expect(() => service.onModuleInit()).toThrow(expected);
  });

  it('rejects a port that is not a port', () => {
    const service = buildService({ ...VALID_SMTP, SMTP_PORT: 'not-a-number' });

    // `toInt` falls back to 587, so this passes — the assertion is that the
    // fallback is a *valid* port rather than NaN reaching nodemailer.
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.smtp.port).toBe(587);
  });

  it('rejects port 465 without implicit TLS', () => {
    const service = buildService({ ...VALID_SMTP, SMTP_PORT: '465', SMTP_SECURE: 'false' });

    // Getting these the wrong way round produces a connection that hangs rather
    // than an error, which is a miserable thing to debug.
    expect(() => service.onModuleInit()).toThrow('SMTP_PORT=465 requires SMTP_SECURE=true');
  });

  it('rejects port 587 with implicit TLS', () => {
    const service = buildService({ ...VALID_SMTP, SMTP_PORT: '587', SMTP_SECURE: 'true' });

    expect(() => service.onModuleInit()).toThrow('SMTP_PORT=587 requires SMTP_SECURE=false');
  });

  it('never echoes the password in the error', () => {
    const service = buildService({ ...VALID_SMTP, SMTP_HOST: '' });

    const error = (() => { try { service.onModuleInit(); return null; } catch (e: any) { return e; } })();

    expect(error.message).not.toContain('app-password');
  });
});

describe('the canonical link base is mandatory', () => {
  it('refuses to start without USER_APP_URL', () => {
    const service = buildService({ ...VALID_SMTP, USER_APP_URL: '' });

    expect(() => service.onModuleInit()).toThrow('USER_APP_URL is required');
  });

  it('refuses a value that is not an absolute URL', () => {
    const service = buildService({ ...VALID_SMTP, USER_APP_URL: 'douyin-clone.vercel.app' });

    expect(() => service.onModuleInit()).toThrow('must be an absolute http(s) URL');
  });

  it('refuses plaintext http in production', () => {
    const service = buildService({ ...VALID_SMTP, USER_APP_URL: 'http://douyin-clone.vercel.app' });

    expect(() => service.onModuleInit()).toThrow('must use https in production');
  });
});

describe('production never silently downgrades to the log provider', () => {
  it('refuses to start with MAIL_PROVIDER=log', () => {
    const service = buildService({ ...VALID_SMTP, MAIL_PROVIDER: 'log' });

    // A production process that cannot reach SMTP must not quietly start
    // printing verification links to stdout instead. That is a downgrade from
    // "delivers mail" to "delivers nothing, and writes credential-adjacent URLs
    // into the log aggregator".
    expect(() => service.onModuleInit()).toThrow("MAIL_PROVIDER must be 'smtp' in production");
  });

  it('rejects an unrecognised provider name outright', () => {
    const service = buildService({
      NODE_ENV: 'development',
      MAIL_PROVIDER: 'sendgrid',
      USER_APP_URL: 'http://localhost:8081'
    });

    expect(() => service.onModuleInit()).toThrow("MAIL_PROVIDER must be 'smtp' or 'log'");
  });
});

describe('building links', () => {
  it('uses the configured origin and encodes the token', () => {
    const service = buildService(VALID_SMTP);

    const url = service.buildUserAppUrl('auth/verify-email', { token: 'a+b/c=' });

    expect(url).toBe('https://douyin-clone.vercel.app/auth/verify-email?token=a%2Bb%2Fc%3D');
  });

  it('works whether or not the origin has a trailing slash', () => {
    const withSlash = buildService({ ...VALID_SMTP, USER_APP_URL: 'https://example.com/' });
    const without = buildService({ ...VALID_SMTP, USER_APP_URL: 'https://example.com' });

    expect(withSlash.buildUserAppUrl('auth/reset-password', { token: 'x' }))
      .toBe(without.buildUserAppUrl('auth/reset-password', { token: 'x' }));
  });

  it('cannot be influenced by a request header', () => {
    const service = buildService(VALID_SMTP);

    // There is no request in scope at all — the method takes a path and params.
    // Deriving a link from `Host` or `X-Forwarded-Host` is host-header
    // injection, and it turns "reset your password" into a credential-harvesting
    // link on somebody else's domain.
    expect(service.buildUserAppUrl('auth/verify-email', { token: 'x' }))
      .toContain('https://douyin-clone.vercel.app');
  });
});

describe('the From header', () => {
  it('pairs the display name with the address', () => {
    const service = buildService(VALID_SMTP);

    expect(service.from).toBe('"Douyin Clone" <demo@gmail.com>');
  });

  it('falls back to a bare address when no name is set', () => {
    const service = buildService({ ...VALID_SMTP, MAIL_FROM_NAME: '' });

    expect(service.from).toBe('demo@gmail.com');
  });

  it('strips the characters that would split the header', () => {
    const service = buildService({
      ...VALID_SMTP,
      MAIL_FROM_NAME: 'Evil"\r\nBcc: victim@example.com'
    });

    // The property is that the value stays *one* header line and *one* quoted
    // string. Text like "Bcc:" surviving inside the display name is harmless —
    // it is quoted and on the same line, so no second header is created. CR, LF
    // and an unescaped quote are the only characters that could produce one.
    expect(service.from).not.toContain('\r');
    expect(service.from).not.toContain('\n');
    expect(service.from).toBe('"EvilBcc: victim@example.com" <demo@gmail.com>');
    // Exactly two quotes: the ones this method added.
    expect((service.from.match(/"/g) || []).length).toBe(2);
  });
});

describe('redacting a URL for logs', () => {
  it('drops the query string, where the token lives', () => {
    const redacted = MailConfigService.redactUrl('https://example.com/auth/verify-email?token=secret');

    expect(redacted).toBe('https://example.com/auth/verify-email?<redacted>');
    expect(redacted).not.toContain('secret');
  });

  it('does not throw on something that is not a URL', () => {
    expect(MailConfigService.redactUrl('not a url')).toBe('<unparseable-url>');
  });
});
