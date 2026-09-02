/**
 * HTTP for the fetch phase: retries, timeouts, per-provider pacing, and
 * downloads streamed to disk.
 *
 * The pacing is deliberate and not driven by the published quotas. Pexels allows
 * 25,000 requests an hour and this tool needs a few hundred; the gap between
 * calls exists because a script that opens every socket it can is rude to a
 * service giving its API away, not because the limit is close. When a provider
 * does publish remaining quota in a header, `rateLimitFloor` stops the run well
 * above zero so the key stays usable for whatever else needs it.
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const logger = require('./logger');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Serialises calls to one provider and keeps a minimum gap between them.
 *
 * A shared promise chain rather than a timestamp check: two callers reading the
 * same "last call was long enough ago" both proceed, which is the bug the pacing
 * exists to prevent.
 */
function createPacer(minIntervalMs) {
  let chain = Promise.resolve();
  let lastAt = 0;
  return (task) => {
    const scheduled = chain.then(async () => {
      const wait = lastAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      return task();
    });
    // Keep the chain alive after a rejection, or one failure stalls every
    // subsequent call behind it forever.
    chain = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  };
}

/** 429 and 5xx are worth retrying; a 4xx is the caller's problem and is not. */
const isRetriableStatus = (status) => status === 429 || status === 408 || status >= 500;

/**
 * A JSON request with bounded retries.
 *
 * `headers` may carry a credential. It is never logged, and the URL is only ever
 * logged after `redact()` — which also strips a key that somehow reached a query
 * string, on the principle that the guard should not depend on this function
 * being the only one that builds URLs.
 */
async function requestJson(url, { headers = {}, timeoutMs, maxRetries, retryBaseDelayMs, label }) {
  let lastReason = 'unknown error';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);

      if (response.ok) {
        return { ok: true, body: await response.json(), headers: response.headers };
      }

      lastReason = `HTTP ${response.status} ${response.statusText}`;
      if (!isRetriableStatus(response.status)) {
        return { ok: false, status: response.status, reason: lastReason };
      }
      // Honour Retry-After when the service sends one; it knows better than a
      // fixed backoff does.
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : retryBaseDelayMs * (2 ** attempt);
      if (attempt < maxRetries) {
        logger.warn(`${label}: ${lastReason}, retrying in ${Math.round(delay / 100) / 10}s`);
        await sleep(delay);
      }
    } catch (error) {
      clearTimeout(timer);
      lastReason = error.name === 'AbortError' ? 'request timed out' : logger.redact(error.message);
      if (attempt < maxRetries) {
        const delay = retryBaseDelayMs * (2 ** attempt);
        logger.warn(`${label}: ${lastReason}, retrying in ${Math.round(delay / 100) / 10}s`);
        await sleep(delay);
      }
    }
  }

  return { ok: false, reason: lastReason };
}

/**
 * Download to a temporary file, then rename into place.
 *
 * The rename is what makes the media cache trustworthy: a crash mid-transfer
 * leaves a `.part` file rather than a short file at the final path that the next
 * run would treat as a complete download and never re-fetch.
 */
async function downloadToFile(url, destination, { timeoutMs, maxRetries, retryBaseDelayMs, label }) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  let lastReason = 'unknown error';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'douyin-clone-demo-seeder/1.0 (+local development tooling)' }
      });

      if (!response.ok) {
        clearTimeout(timer);
        lastReason = `HTTP ${response.status} ${response.statusText}`;
        if (!isRetriableStatus(response.status)) {
          return { ok: false, reason: lastReason };
        }
      } else {
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
        clearTimeout(timer);
        fs.renameSync(temporary, destination);
        return {
          ok: true,
          bytes: fs.statSync(destination).size,
          contentType: response.headers.get('content-type') || null
        };
      }
    } catch (error) {
      clearTimeout(timer);
      lastReason = error.name === 'AbortError' ? 'download timed out' : logger.redact(error.message);
    }

    // Never leave a partial file behind between attempts.
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch { /* the next attempt overwrites it anyway */ }

    if (attempt < maxRetries) {
      const delay = retryBaseDelayMs * (2 ** attempt);
      logger.warn(`${label}: ${lastReason}, retrying in ${Math.round(delay / 100) / 10}s`);
      await sleep(delay);
    }
  }

  return { ok: false, reason: lastReason };
}

module.exports = {
  createPacer, requestJson, downloadToFile, sleep
};
