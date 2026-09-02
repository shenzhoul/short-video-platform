/**
 * Console output for the demo scripts, with credential redaction that cannot be
 * forgotten at a call site.
 *
 * Every string this module prints — a message, an interpolated value, an error's
 * message and its stack — is passed through `redact()` first. That is the whole
 * point: an API key reaches a log by accident, not on purpose, and the accident
 * is usually an error object that quotes the request it failed on. A rule that
 * says "remember not to log the key" fails the first time somebody prints an
 * exception. Doing it in the sink means there is no call site to get wrong.
 *
 * Secrets are registered once at startup by `env.js`.
 */

/** Values that must never appear in output. Registered, never printed. */
const secrets = new Set();

/**
 * Register a value as unprintable.
 *
 * Short values are ignored: a two-character "secret" would redact half of every
 * ordinary sentence, which destroys the log without protecting anything.
 */
function registerSecret(value) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length < 8) return;
  secrets.add(trimmed);
}

/**
 * Replace every registered secret in a string with a marker.
 *
 * Also strips the two query parameters the providers accept a key in, so that a
 * URL built the wrong way is caught even if the key itself was never registered
 * — Pixabay takes its key as `?key=`, and a misuse of Pexels would use
 * `?api_key=`. This module never builds such a URL; the guard is here because
 * the cost of being wrong is a published credential.
 */
function redact(text) {
  let output = String(text);
  for (const secret of secrets) {
    if (output.includes(secret)) output = output.split(secret).join('[REDACTED]');
  }
  return output
    .replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"']+/gi, '$1[REDACTED]');
}

/** Redact anything before it is printed, including nested errors. */
function clean(value) {
  if (value instanceof Error) {
    const message = redact(value.message);
    const code = value.code ? ` (${value.code})` : '';
    return `${value.name}: ${message}${code}`;
  }
  if (value && typeof value === 'object') {
    try {
      return redact(JSON.stringify(value));
    } catch {
      return redact(String(value));
    }
  }
  return redact(value);
}

const write = (stream, prefix, parts) => {
  stream.write(`${prefix}${parts.map(clean).join(' ')}\n`);
};

module.exports = {
  registerSecret,
  redact,
  info: (...parts) => write(process.stdout, '', parts),
  step: (...parts) => write(process.stdout, '\n▸ ', parts),
  detail: (...parts) => write(process.stdout, '  ', parts),
  ok: (...parts) => write(process.stdout, '  ✓ ', parts),
  skip: (...parts) => write(process.stdout, '  · ', parts),
  warn: (...parts) => write(process.stdout, '  ! ', parts),
  error: (...parts) => write(process.stderr, '  ✗ ', parts)
};
