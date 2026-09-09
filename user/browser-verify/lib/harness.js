/**
 * Shared harness for the browser verification pass.
 *
 * Everything here drives a real Chromium against the production build. The
 * point of the exercise is that a *gesture* produces the event — not that an
 * endpoint accepts a payload, which the API-level scripts already prove — so
 * nothing in here calls the recommendation endpoints directly or invokes a
 * React handler. Sign-in goes through the real login form.
 *
 * Every recommendation request the page makes is captured with its parsed
 * body and the server's own accepted/deduped/rejected reply, so a scenario can
 * assert on the whole chain:
 *
 *   gesture -> network batch -> server verdict -> persisted rows
 *
 * Bearer tokens are never recorded.
 */

const path = require('path');
const fs = require('fs');
/*
 * Playwright is not a dependency of the app — it is verification tooling, and
 * adding it to `user/package.json` would put a browser driver into the
 * product's dependency tree for the sake of a one-off pass. `PLAYWRIGHT_PATH`
 * points at an install outside the repo.
 */
const PLAYWRIGHT_PATH = process.env.PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) {
  throw new Error('set PLAYWRIGHT_PATH to a playwright install, e.g. <scratch>/pw/node_modules/playwright');
}
// eslint-disable-next-line import/no-dynamic-require, global-require
const { chromium } = require(PLAYWRIGHT_PATH);

const USER_APP = process.env.USER_APP || 'http://localhost:8081';
const API = process.env.API || 'http://localhost:8080';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SHOT_DIR = path.join(REPO_ROOT, 'output', 'screenshots');

const EVENTS_PATH = '/posts/recommendation-events';

function ensureShotDir() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

/**
 * One browser context — an independent cookie jar, storage and session, which
 * is what makes "context A" and "context B" genuinely different people rather
 * than two tabs of the same login.
 */
async function openContext(browser, label) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // Real media would make every run depend on network and decode timing;
    // the recommendation signals under test are driven by DOM visibility and
    // <video> events, both of which work without fetching the actual bytes.
    recordVideo: undefined
  });
  const page = await context.newPage();

  /** Every recommendation batch this context sent, with the server's verdict. */
  const captured = [];

  page.on('request', (request) => {
    if (!request.url().includes(EVENTS_PATH)) return;
    let body = null;
    try {
      body = JSON.parse(request.postData() || '{}');
    } catch {
      body = { unparsed: true };
    }
    captured.push({
      at: Date.now(),
      label,
      events: (body.events || []).map((event) => ({
        eventType: event.eventType,
        postId: event.postId,
        sessionId: event.sessionId,
        source: event.source,
        watchMs: event.watchMs,
        durationMs: event.durationMs,
        dwellMs: event.dwellMs,
        clientExposureId: event.clientExposureId,
        commentId: event.commentId
      })),
      anonymousId: body.anonymousId,
      // Filled in by the response handler below.
      verdict: null
    });
  });

  page.on('response', async (response) => {
    if (!response.url().includes(EVENTS_PATH)) return;
    const pending = captured.filter((row) => row.verdict === null);
    const target = pending[0];
    if (!target) return;
    try {
      const json = await response.json();
      target.verdict = { status: response.status(), ...(json?.data || json) };
    } catch {
      target.verdict = { status: response.status(), unparsed: true };
    }
  });

  return {
    label,
    context,
    page,
    captured,
    /** Events of one type seen so far, newest last. */
    eventsOfType(eventType) {
      return captured.flatMap((row) => row.events
        .filter((event) => event.eventType === eventType)
        .map((event) => ({ ...event, verdict: row.verdict })));
    },
    /** Every event for one post, in send order. */
    eventsForPost(postId) {
      return captured.flatMap((row) => row.events
        .filter((event) => event.postId === postId)
        .map((event) => ({ ...event, verdict: row.verdict })));
    },
    totals() {
      return captured.reduce((acc, row) => {
        acc.batches += 1;
        acc.events += row.events.length;
        acc.accepted += row.verdict?.accepted || 0;
        acc.deduped += row.verdict?.deduped || 0;
        acc.rejected += row.verdict?.rejected || 0;
        return acc;
      }, {
        batches: 0, events: 0, accepted: 0, deduped: 0, rejected: 0
      });
    },
    async shot(name) {
      ensureShotDir();
      const file = path.join(SHOT_DIR, name.endsWith('.png') ? name : `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    },
    async close() {
      await context.close();
    }
  };
}

/**
 * Signs in through the real login dialog.
 *
 * The web client sha256s the password before sending, but that is the app's
 * business — this types the plain password into the form exactly as a person
 * would, so the client-side hashing is part of what gets exercised.
 */
async function signIn(ctx, email, password = 'demodemo') {
  const { page } = ctx;
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });

  // The login entry point is a dialog opened from the header.
  const loginTrigger = page.getByRole('button', { name: /log ?in|sign ?in/i }).first();
  await loginTrigger.waitFor({ state: 'visible', timeout: 20000 });
  await loginTrigger.click();

  const dialog = page.locator('[role="dialog"], .ant-modal, [data-testid="auth-modal"]').first();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });

  // Some flows land on a chooser first.
  const emailOption = dialog.getByText(/use (email|phone)|email \/ username|email/i).first();
  if (await emailOption.isVisible().catch(() => false)) {
    await emailOption.click().catch(() => {});
  }

  const identifier = dialog.locator('input[type="text"], input[type="email"], input[name*="user" i], input[name*="email" i]').first();
  await identifier.waitFor({ state: 'visible', timeout: 15000 });
  await identifier.fill(email);

  const secret = dialog.locator('input[type="password"]').first();
  await secret.fill(password);

  await dialog.getByRole('button', { name: /log ?in|sign ?in|continue|submit/i }).first().click();

  // Signed in when the dialog is gone.
  await dialog.waitFor({ state: 'detached', timeout: 25000 }).catch(async () => {
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  });
  await page.waitForTimeout(1500);
}

/** Waits until the queue has flushed at least `count` batches, or times out. */
async function waitForBatches(ctx, count, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (ctx.captured.length >= count) {
      // Give the response handler a moment to attach the verdict.
      await ctx.page.waitForTimeout(400);
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.waitForTimeout(250);
  }
  return ctx.captured.length >= count;
}

/** Waits for an event of a given type to have been sent. */
async function waitForEvent(ctx, eventType, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (ctx.eventsOfType(eventType).length > 0) {
      await ctx.page.waitForTimeout(400);
      return ctx.eventsOfType(eventType);
    }
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.waitForTimeout(250);
  }
  return ctx.eventsOfType(eventType);
}


/**
 * Redirect media requests for the stopped local file-server.
 *
 * Some media URLs are stored absolute in Mongo against `localhost:8000`, and
 * that file-server is no longer running in this environment. Rewriting them in
 * the *browser context only* keeps the review screenshots faithful without
 * touching the database, the app, or port 8000 itself. Set `MEDIA_ORIGIN` to
 * the review file-server; omit it and nothing is rewritten.
 */
async function routeMediaOrigin(context) {
  const target = process.env.MEDIA_ORIGIN;
  if (!target) return;
  await context.route('**://localhost:8000/**', (route) => {
    const url = route.request().url().replace('http://localhost:8000', target);
    route.continue({ url });
  });
}

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed, detail });
  console.log(`  ${passed ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  return passed;
}

function summarise(title) {
  console.log(`\n=== ${title} ===`);
  const failed = results.filter((row) => !row.passed);
  if (!failed.length) {
    console.log(`  all ${results.length} checks passed`);
    return 0;
  }
  failed.forEach((row) => console.log(`  FAILED: ${row.label}${row.detail ? ` — ${row.detail}` : ''}`));
  return 1;
}

module.exports = {
  chromium,
  routeMediaOrigin,
  USER_APP,
  API,
  SHOT_DIR,
  openContext,
  signIn,
  waitForBatches,
  waitForEvent,
  check,
  summarise,
  results
};
