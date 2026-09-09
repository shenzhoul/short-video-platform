/**
 * Console audit — classify every message by who owns it, before fixing anything.
 *
 * The reported console came from an everyday Edge profile with extensions
 * loaded, so the first job is separating what the *app* emits from what the
 * browser, an extension, or a script pasted into DevTools emits. A clean
 * context with no extensions is the control: anything that survives it is
 * app-owned and anything that disappears is not.
 *
 * Every message is recorded with its source URL, so `contentscript.js` and
 * `VM54` classify themselves rather than being argued about.
 *
 *   TARGET=https://app.136.85.26.121.sslip.io  (read-only production check)
 *   TARGET=http://localhost:8085               (the review build)
 */
const fs = require('fs');
const path = require('path');

const { chromium, SHOT_DIR, signIn } = require('./lib/harness');

const TARGET = process.env.TARGET || process.env.USER_APP || 'http://localhost:8085';
const ROUTE = process.env.ROUTE || '/maitran.eats';
const LABEL = process.env.LABEL || 'clean';
/*
  Hydration mismatches very often depend on auth state — the server renders for
  a visitor and the client re-renders for a signed-in account. An audit that
  only ever looks at the signed-out page is not looking at the reported state.
*/
const SIGN_IN = process.env.SIGN_IN || '';
const W = Number(process.env.W || 440);
const H = Number(process.env.H || 956);

/** Where a message came from, in the terms the brief asks for. */
function classify(entry) {
  const url = entry.url || '';
  const text = entry.text || '';
  if (/contentscript\.js|extension:\/\/|chrome-extension|moz-extension/i.test(url)
    || /ObjectMultiplex|MaxListenersExceededWarning/i.test(text)) {
    return 'extension-owned';
  }
  // `VM<number>` is Chromium's name for a script with no source URL — eval,
  // an injected snippet, or something pasted into the console.
  if (/^VM\d+/.test(url) || url === '' || /^<anonymous>/.test(url)) {
    return 'devtools/injected-owned';
  }
  if (/^\[Intervention\]/.test(text) || /Images loaded lazily/i.test(text)) {
    return 'browser-owned';
  }
  if (/403|Failed to load resource/i.test(text) && /health/i.test(text)) {
    return 'infrastructure/config-owned';
  }
  if (url.startsWith(TARGET) || /_next\/static|\/static\/chunks/.test(url)) {
    return 'app-owned';
  }
  return 'unclassified';
}

const messages = [];
const failedRequests = [];

(async () => {
  const browser = await chromium.launch({
    // A clean context: no extensions, no profile, nothing injected.
    args: ['--disable-extensions', '--disable-plugins']
  });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    const loc = msg.location() || {};
    messages.push({
      type: msg.type(),
      text: msg.text().slice(0, 400),
      url: loc.url || '',
      line: loc.lineNumber,
      column: loc.columnNumber
    });
  });
  page.on('pageerror', (error) => {
    messages.push({
      type: 'pageerror',
      text: `${error.message}`.slice(0, 400),
      url: (error.stack || '').split('\n')[1]?.trim() || '',
      stack: (error.stack || '').split('\n').slice(0, 6).join(' | ')
    });
  });
  page.on('requestfailed', (request) => {
    failedRequests.push({ url: request.url().slice(0, 160), failure: request.failure()?.errorText });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push({ url: response.url().slice(0, 160), status: response.status() });
    }
  });

  console.log(`\n=== console audit: ${TARGET}${ROUTE} @ ${W}x${H} (${LABEL}) ===`);
  console.log('    clean context: no extensions, no injected scripts\n');

  if (SIGN_IN) {
    await signIn({ page }, SIGN_IN).catch((e) => console.log(`    sign-in failed: ${e.message.slice(0, 100)}`));
    // Sign-in traffic is not what is under audit; start recording after it.
    messages.length = 0;
    failedRequests.length = 0;
  }

  await page.goto(`${TARGET}${ROUTE}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => {
    console.log(`    navigation issue: ${e.message.slice(0, 120)}`);
  });
  await page.waitForTimeout(6000);
  // A little interaction, since hydration errors often surface on the first
  // client-side state change rather than on load.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(2500);

  const grouped = {};
  messages.forEach((m) => {
    const owner = classify(m);
    grouped[owner] = grouped[owner] || [];
    grouped[owner].push(m);
  });

  Object.entries(grouped).forEach(([owner, list]) => {
    console.log(`--- ${owner}: ${list.length} ---`);
    list.slice(0, 12).forEach((m) => {
      console.log(`    [${m.type}] ${m.text.replace(/\s+/g, ' ').slice(0, 190)}`);
      if (m.url) console.log(`        from ${m.url.slice(0, 130)}${m.line ? `:${m.line}` : ''}`);
      if (m.stack) console.log(`        stack ${m.stack.slice(0, 190)}`);
    });
    console.log('');
  });

  const appErrors = (grouped['app-owned'] || []).filter((m) => m.type === 'error' || m.type === 'pageerror');
  const hydration = messages.filter((m) => /Minified React error #(418|423|425)|Hydration failed|did not match/i.test(m.text));

  console.log('--- failed requests ---');
  if (!failedRequests.length) console.log('    none');
  failedRequests.slice(0, 10).forEach((f) => console.log(`    ${f.status || f.failure}  ${f.url}`));

  console.log('\n--- verdict ---');
  console.log(`    app-owned uncaught errors : ${appErrors.length}`);
  console.log(`    hydration errors          : ${hydration.length}`);
  hydration.forEach((h) => console.log(`        ${h.text.replace(/\s+/g, ' ').slice(0, 190)}`));

  await page.screenshot({ path: path.join(SHOT_DIR, `44-console-${LABEL}-${W}x${H}.png`) });

  const out = path.join(SHOT_DIR, '..', `console-audit-${LABEL}.json`);
  fs.writeFileSync(out, JSON.stringify({
    target: `${TARGET}${ROUTE}`,
    label: LABEL,
    viewport: `${W}x${H}`,
    grouped: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length])),
    messages,
    failedRequests,
    appErrors: appErrors.length,
    hydrationErrors: hydration.length
  }, null, 2));
  console.log(`\nwrote ${out}`);

  await context.close();
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
