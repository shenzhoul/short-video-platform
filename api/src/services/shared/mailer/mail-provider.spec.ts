import * as nodemailer from 'nodemailer';

import { MAIL_PROVIDER } from 'src/common/interfaces/mailer';
import { LogMailProvider } from './log-mail.provider';
import { mailProviderFactory } from './mail-provider.factory';
import { SmtpMailProvider } from './smtp-mail.provider';

/**
 * Which transport gets built, and what it does with a failure.
 *
 * The first block is the one that matters most: **no test in this repository may
 * open a connection to a real mail server.** `createTransport` is mocked
 * throughout, and the factory tests assert that the SMTP implementation is not
 * even constructed when the configuration selects the log provider.
 */

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const createTransport = nodemailer.createTransport as unknown as jest.Mock;

function fakeConfig(overrides: Record<string, any> = {}) {
  return {
    provider: 'smtp',
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'demo@gmail.com',
      pass: 'app-password'
    },
    from: '"Douyin Clone" <demo@gmail.com>',
    ...overrides
  } as any;
}

const MESSAGE = {
  to: 'visitor@example.com',
  subject: 'Confirm your email address',
  html: '<p>hello</p>',
  text: 'hello\nhttps://douyin-clone.vercel.app/auth/verify-email?token=SECRET-TOKEN\n'
};

beforeEach(() => {
  createTransport.mockReset();
  createTransport.mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
});

describe('choosing a transport', () => {
  it('builds the SMTP provider when configured for smtp', () => {
    const provider = (mailProviderFactory as any).useFactory(fakeConfig());

    expect(provider).toBeInstanceOf(SmtpMailProvider);
    expect(provider.kind).toBe('smtp');
  });

  it('builds the log provider when configured for log', () => {
    const provider = (mailProviderFactory as any).useFactory(fakeConfig({ provider: 'log' }));

    expect(provider).toBeInstanceOf(LogMailProvider);
    expect(provider.kind).toBe('log');
  });

  it('never constructs an SMTP transport for the log provider', async () => {
    const provider = (mailProviderFactory as any).useFactory(fakeConfig({ provider: 'log' }));

    await provider.send(MESSAGE);

    // Both implementations are constructed inside the factory rather than
    // registered as Nest providers, so exactly one exists in the process. This
    // is what lets a test suite assert no mail transport exists at all.
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe('the SMTP transport', () => {
  it('keeps certificate validation on and requires TLS on the submission port', async () => {
    const provider = new SmtpMailProvider(fakeConfig());

    await provider.send(MESSAGE);

    const [options] = createTransport.mock.calls[0];
    expect(options.host).toBe('smtp.gmail.com');
    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
    // 587 is STARTTLS: nodemailer upgrades after connecting, and `requireTLS`
    // makes that non-optional rather than opportunistic.
    expect(options.requireTLS).toBe(true);
    // The reference implementation set `rejectUnauthorized: false`, which lets
    // any machine on the path present its own certificate and read the SMTP
    // credentials in the clear.
    expect(options.tls?.rejectUnauthorized).not.toBe(false);
  });

  it('builds the transport once and reuses it', async () => {
    const provider = new SmtpMailProvider(fakeConfig());

    await provider.send(MESSAGE);
    await provider.send(MESSAGE);
    await provider.send(MESSAGE);

    // A fresh transport per message throws away the connection pool and pays a
    // TLS handshake each time — and a burst of new connections is exactly the
    // pattern that trips Gmail's abuse heuristics.
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('sends both the html and the text part', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    createTransport.mockReturnValue({ sendMail });
    const provider = new SmtpMailProvider(fakeConfig());

    await provider.send(MESSAGE);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: '"Douyin Clone" <demo@gmail.com>',
      to: 'visitor@example.com',
      html: MESSAGE.html,
      text: MESSAGE.text
    }));
  });

  it('throws so the queue retries, without forwarding the library\'s words', async () => {
    const sendMail = jest.fn().mockRejectedValue(
      new Error('Invalid login: 535-5.7.8 Username and Password not accepted')
    );
    createTransport.mockReturnValue({ sendMail });
    const provider = new SmtpMailProvider(fakeConfig());

    // Throwing is what earns the BullMQ retry. The implementation this replaces
    // caught everything and logged, so every job was recorded complete and a
    // dead SMTP host produced an application that delivered nothing.
    await expect(provider.send(MESSAGE)).rejects.toThrow('Mail delivery failed');
    // What nodemailer says is a fact about our credentials, not advice for
    // whoever is waiting on the email.
    await expect(provider.send(MESSAGE)).rejects.not.toThrow(/535/);
  });
});

describe('the log transport', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('redacts the token by default', async () => {
    const provider = new LogMailProvider(fakeConfig({ provider: 'log' }));
    const logged: string[] = [];
    jest.spyOn((provider as any).logger, 'log').mockImplementation((m: any) => { logged.push(String(m)); });
    const debug = jest.spyOn((provider as any).logger, 'debug').mockImplementation(() => undefined);

    await provider.send(MESSAGE);

    // A raw token in a log file is a live credential in a log file — collected
    // by whatever ships logs and readable by anyone with log access.
    expect(logged.join('\n')).not.toContain('SECRET-TOKEN');
    expect(logged.join('\n')).toContain('<redacted>');
    expect(debug).not.toHaveBeenCalled();
  });

  it('reveals the link only when a developer opts in outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.MAIL_LOG_REVEAL_LINKS = 'true';
    const provider = new LogMailProvider(fakeConfig({ provider: 'log' }));
    jest.spyOn((provider as any).logger, 'log').mockImplementation(() => undefined);
    const debug = jest.spyOn((provider as any).logger, 'debug').mockImplementation(() => undefined);

    await provider.send(MESSAGE);

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('SECRET-TOKEN'));
  });

  it('refuses to reveal the link in production even when asked', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_LOG_REVEAL_LINKS = 'true';
    const provider = new LogMailProvider(fakeConfig({ provider: 'log' }));
    jest.spyOn((provider as any).logger, 'log').mockImplementation(() => undefined);
    const debug = jest.spyOn((provider as any).logger, 'debug').mockImplementation(() => undefined);

    await provider.send(MESSAGE);

    // Belt and braces: MailConfigService already refuses to boot with this
    // provider under NODE_ENV=production.
    expect(debug).not.toHaveBeenCalled();
  });

  it('opens no connection at all', async () => {
    const provider = new LogMailProvider(fakeConfig({ provider: 'log' }));
    jest.spyOn((provider as any).logger, 'log').mockImplementation(() => undefined);

    await provider.send(MESSAGE);

    expect(createTransport).not.toHaveBeenCalled();
  });
});
