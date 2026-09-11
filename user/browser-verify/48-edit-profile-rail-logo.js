/**
 * Edit profile dialog and the compact rail's logo — geometry pass.
 *
 * Measures, at 390x844, 440x956, 768x1024 and 1440x900, against the local
 * production build:
 *
 *   - the rail's app mark: present below `lg`, inside the rail, level with the
 *     header band, "Get APP" starting under it, the rail still fitting without
 *     scrolling, and the link leading home; absent at desktop, where the
 *     wordmark stays;
 *   - the Edit profile dialog: width, height, title, avatar, field, textarea,
 *     button and close-button boxes, and that it sits inside the viewport;
 *   - the dialog still works: typing enables Save, Cancel and Escape close it.
 *     Nothing is saved — the demo account's profile is never written.
 *
 *   PLAYWRIGHT_PATH=<playwright> node browser-verify/48-edit-profile-rail-logo.js --label before|after
 *
 * `before` records numbers and screenshots only; `after` asserts the targets
 * measured off the Douyin reference (a 240px dialog at a 440px viewport) and
 * exits non-zero if any fails. Desktop is held to its current numbers.
 *
 * Env: PLAYWRIGHT_PATH (required), USER_APP, MENU_ACCOUNT, ONLY.
 */

const path = require('path');
const fs = require('fs');
const {
  chromium, USER_APP, SHOT_DIR, signIn, check, summarise
} = require('./lib/harness');

const LABEL = (process.argv.find((arg) => arg.startsWith('--label=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--label') + 1] || 'after';
const ASSERT = LABEL === 'after';
const ACCOUNT = process.env.MENU_ACCOUNT || 'maitran.eats@demo.invalid';
const OWN_PROFILE = process.env.OWN_PROFILE || 'maitran.eats';
const SHOTS = path.join(SHOT_DIR, 'edit-profile-rail-logo', LABEL);
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'output', 'playwright', 'edit-profile-rail-logo');

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, compact: true },
  { name: '440x956', width: 440, height: 956, compact: true },
  { name: '768x1024', width: 768, height: 1024, compact: true },
  { name: '1440x900', width: 1440, height: 900, compact: false }
];
const ONLY = (process.env.ONLY || '').split(',').map((value) => value.trim()).filter(Boolean);
const report = { label: LABEL, viewports: {} };
/** The dialog's form; the data hook is new, so a `before` build is found by its role. */
const FORM = '[data-edit-profile-form], [role="dialog"] form';

function expect(viewport, label, passed, detail) {
  if (!ASSERT) {
    console.log(`  · ${label}${detail ? ` — ${detail}` : ''}`);
    return passed;
  }
  return check(`[${viewport.name}] ${label}`, passed, detail);
}

const within = (value, min, max) => typeof value === 'number' && value >= min && value <= max;

async function shot(page, viewport, name) {
  const dir = path.join(SHOTS, viewport.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function measureRail(page) {
  return page.evaluate(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10
      };
    };
    const rail = document.querySelector('[data-app-nav-rail]');
    const logo = rail.querySelector('[data-app-rail-logo]');
    const glyph = logo?.querySelector('svg');
    const getApp = rail.querySelector('a[aria-label="Get the app"]');
    const header = document.querySelector('header') || document.querySelector('[data-app-header]');
    const scroller = rail.querySelector('.overflow-y-auto');
    const wordmark = rail.querySelector('a[href="/"] img, a[href="/"] div.font-bold');
    return {
      rail: box(rail),
      logo: box(logo),
      logoDisplay: logo ? getComputedStyle(logo).display : null,
      logoLabel: logo?.getAttribute('aria-label') || null,
      glyph: box(glyph),
      getApp: box(getApp),
      header: box(header),
      scrollerOverflow: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
      wordmark: box(wordmark),
      headerHeightToken: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')) * (getComputedStyle(document.documentElement).getPropertyValue('--app-header-height').includes('rem') ? 16 : 1)
    };
  });
}

async function measureDialog(page) {
  return page.evaluate(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10
      };
    };
    const font = (node) => (node ? parseFloat(getComputedStyle(node).fontSize) : null);
    const form = document.querySelector('[data-edit-profile-form]') || document.querySelector('[role="dialog"] form');
    const dialog = form.closest('[role="dialog"]');
    const title = form.querySelector('h2');
    const avatar = form.querySelector('img[alt="Avatar"]')?.parentElement?.parentElement;
    const camera = form.querySelector('img[alt="Avatar"] + span');
    const caption = [...form.querySelectorAll('div')].find((node) => !node.children.length && node.textContent.trim() === 'Click to change your avatar');
    const nameInput = form.querySelector('#form-field-name');
    const nameLabel = form.querySelector('label[for="form-field-name"]');
    const counter = nameInput?.parentElement?.querySelector('span');
    const bio = form.querySelector('#form-field-bio');
    const buttons = [...form.querySelectorAll('button')];
    const cancel = buttons.find((node) => node.textContent.trim() === 'Cancelled');
    const save = buttons.find((node) => /^(Save|Saving\.\.\.)$/.test(node.textContent.trim()));
    const close = dialog.querySelector('button[aria-label="Close"]');
    return {
      dialog: box(dialog),
      title: { ...box(title), font: font(title) },
      avatar: box(avatar),
      cameraSize: camera ? getComputedStyle(camera).backgroundSize : null,
      caption: { ...box(caption), font: font(caption) },
      nameLabel: { ...box(nameLabel), font: font(nameLabel) },
      nameInput: { ...box(nameInput), font: font(nameInput) },
      counter: { ...box(counter), font: font(counter) },
      bio: { ...box(bio), font: font(bio) },
      cancel: { ...box(cancel), font: font(cancel) },
      save: { ...box(save), font: font(save), disabled: save?.disabled },
      close: box(close),
      closeGlyph: box(close?.querySelector('svg'))
    };
  });
}

async function runViewport(browser, viewport) {
  console.log(`\n── ${viewport.name}`);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const failedRequests = [];
  const consoleErrors = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && /\/(api|posts|users|identity|creator|notifications|conversations)\b/.test(response.url())) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
 if (message.type() === 'error') consoleErrors.push(message.text());
});
  await signIn({ page, context }, ACCOUNT);
  await page.goto(`${USER_APP}/${OWN_PROFILE}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-profile-hero]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);

  const result = { rail: await measureRail(page) };
  const { rail } = result;
  console.log(`  rail ${JSON.stringify(rail)}`);
  await shot(page, viewport, '01-rail-logo');

  if (ASSERT && viewport.compact) {
    expect(viewport, 'rail shows the app mark', !!rail.logo && rail.logoDisplay !== 'none', JSON.stringify(rail.logo));
    expect(viewport, 'app mark sits inside the rail column', rail.logo && rail.logo.x >= rail.rail.x - 0.5 && rail.logo.right <= rail.rail.right + 0.5);
    expect(viewport, 'app mark fills the header band from the top', rail.logo && rail.logo.y <= 0.5 && Math.abs(rail.logo.h - rail.headerHeightToken) <= 1, `logo y ${rail.logo?.y} h ${rail.logo?.h}, header token ${rail.headerHeightToken}`);
    const glyphCentre = rail.glyph ? rail.glyph.y + rail.glyph.h / 2 : null;
    const headerCentre = rail.header ? rail.header.y + rail.header.h / 2 : null;
    expect(viewport, 'glyph is 16-20px and level with the header', rail.glyph && within(rail.glyph.w, 16, 20) && (headerCentre === null || Math.abs(glyphCentre - headerCentre) <= 2), `glyph ${JSON.stringify(rail.glyph)}, header centre ${headerCentre}`);
    expect(viewport, 'glyph is centred in the rail', rail.glyph && Math.abs((rail.glyph.x + rail.glyph.w / 2) - (rail.rail.x + rail.rail.w / 2)) <= 1.5);
    expect(viewport, '"Get APP" starts under the app mark', rail.getApp && rail.logo && rail.getApp.y >= rail.logo.bottom - 0.5 && rail.getApp.y - rail.logo.bottom <= 4, `getApp y ${rail.getApp?.y}, logo bottom ${rail.logo?.bottom}`);
    expect(viewport, 'rail navigation still fits without scrolling', rail.scrollerOverflow !== null && rail.scrollerOverflow <= 1, `overflow ${rail.scrollerOverflow}`);
    expect(viewport, 'app mark has an accessible name', !!rail.logoLabel, rail.logoLabel);
  }
  if (ASSERT && !viewport.compact) {
    expect(viewport, 'desktop: no app mark, wordmark kept', (!rail.logo || rail.logoDisplay === 'none') && !!rail.wordmark, JSON.stringify({ logo: rail.logo, wordmark: rail.wordmark }));
  }

  // Dark theme rail, for the mark's colour on both grounds.
  if (viewport.name === '440x956') {
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-profile-hero]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot(page, viewport, '02-rail-logo-dark');
  }

  // Edit profile dialog.
  await page.locator('[data-profile-name] span.cursor-pointer').click();
  await page.locator(FORM).waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  const dialog = await measureDialog(page);
  result.dialog = dialog;
  console.log(`  dialog ${JSON.stringify(dialog)}`);
  await shot(page, viewport, viewport.name === '440x956' ? '03-edit-profile-dark' : '03-edit-profile');

  if (ASSERT && viewport.compact) {
    const d = dialog;
    expect(viewport, 'dialog is 236-244px wide', within(d.dialog.w, 236, 244), `w ${d.dialog.w}`);
    expect(viewport, 'dialog is 280-320px tall', within(d.dialog.h, 280, 320), `h ${d.dialog.h}`);
    expect(viewport, 'dialog sits inside the viewport', d.dialog.x >= 0 && d.dialog.right <= viewport.width && d.dialog.y >= 0 && d.dialog.bottom <= viewport.height);
    expect(viewport, 'dialog is centred on the viewport', Math.abs((d.dialog.x + d.dialog.w / 2) - viewport.width / 2) <= 1, `centre ${d.dialog.x + d.dialog.w / 2}`);
    expect(viewport, 'title is 10px', within(d.title.font, 9.5, 11), `font ${d.title.font}`);
    expect(viewport, 'avatar is 52-60px', within(d.avatar.w, 52, 60) && Math.abs(d.avatar.w - d.avatar.h) <= 0.5, `avatar ${d.avatar.w}x${d.avatar.h}`);
    expect(viewport, 'camera glyph scaled with the avatar', d.cameraSize === '14px 14px', d.cameraSize);
    expect(viewport, 'caption, labels and fields are 7-9px', [d.caption.font, d.nameLabel.font, d.nameInput.font, d.bio.font].every((size) => within(size, 7, 9)), JSON.stringify([d.caption.font, d.nameLabel.font, d.nameInput.font, d.bio.font]));
    expect(viewport, 'name field is 14-18px tall and 196-204px wide', within(d.nameInput.h, 14, 18) && within(d.nameInput.w, 196, 204), `${d.nameInput.w}x${d.nameInput.h}`);
    expect(viewport, 'name counter stays inside the field', d.counter.right <= d.nameInput.right && d.counter.bottom <= d.nameInput.bottom + 0.5 && d.counter.y >= d.nameInput.y - 0.5, JSON.stringify(d.counter));
    expect(viewport, 'introduction is 60-68px tall', within(d.bio.h, 60, 68), `h ${d.bio.h}`);
    expect(viewport, 'buttons are 72-76 x 16-20px, 7-9px text', [d.cancel, d.save].every((b) => within(b.w, 72, 76) && within(b.h, 16, 20) && within(b.font, 7, 9)), JSON.stringify([d.cancel, d.save]));
    expect(viewport, 'buttons centred as a pair', Math.abs(((d.cancel.x + d.save.right) / 2) - (d.dialog.x + d.dialog.w / 2)) <= 1);
    expect(viewport, 'close button is 20px with a 12px glyph, in the corner', within(d.close.w, 19, 21) && within(d.closeGlyph.w, 11, 13) && d.dialog.right - d.close.right <= 4 && d.close.y - d.dialog.y <= 4, JSON.stringify({ close: d.close, glyph: d.closeGlyph }));
    const order = [d.title, d.avatar, d.caption, d.nameLabel, d.nameInput, d.bio, d.cancel];
    expect(viewport, 'nothing in the form overlaps vertically', order.every((item, index) => index === 0 || item.y >= order[index - 1].bottom - 0.5), JSON.stringify(order.map((item) => [item.y, item.bottom])));
  }
  if (ASSERT && !viewport.compact) {
    const d = dialog;
    expect(viewport, 'desktop dialog unchanged: 480 wide, 108 avatar, 148x36 buttons, 20px title', d.dialog.w === 480 && d.avatar.w === 108 && d.cancel.w === 148 && d.cancel.h === 36 && d.title.font === 20, JSON.stringify({ w: d.dialog.w, avatar: d.avatar.w, cancel: [d.cancel.w, d.cancel.h], title: d.title.font }));
  }

  // Functional: Save is disabled until something changes; typing enables it;
  // nothing is submitted.
  if (ASSERT) {
    expect(viewport, 'Save disabled before any change', dialog.save.disabled === true);
    await page.locator('#form-field-bio').focus();
    await page.keyboard.type(' x');
    const enabled = await page.locator(`${FORM} >> button[type="submit"]`).isEnabled();
    expect(viewport, 'typing enables Save', enabled);
    await page.getByRole('button', { name: 'Cancelled' }).click();
    await page.waitForTimeout(500);
    expect(viewport, 'Cancel closes the dialog', await page.locator(FORM).count() === 0);
    await page.locator('[data-profile-name] span.cursor-pointer').click();
    await page.locator(FORM).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    expect(viewport, 'Escape closes the dialog', await page.locator(FORM).count() === 0);

    if (viewport.compact) {
      await page.locator('[data-app-rail-logo]').click();
      await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 15000 });
      expect(viewport, 'app mark leads home', new URL(page.url()).pathname === '/');
    }
    expect(viewport, 'no failed API request', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));
    expect(viewport, 'no console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  }

  if (viewport.name === '440x956') {
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
  }
  report.viewports[viewport.name] = result;
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS.filter((item) => !ONLY.length || ONLY.includes(item.name))) {

      await runViewport(browser, viewport);
    }
  } finally {
    await browser.close();
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, `${LABEL}${ONLY.length ? `-${ONLY.join('_')}` : ''}.json`), JSON.stringify(report, null, 2));
  }
  process.exit(ASSERT ? summarise(`edit profile and rail logo (${LABEL})`) : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
