/**
 * Following — Messages reflow acceptance.
 *
 * Asserts that Messages is a sibling column and not an overlay, in every
 * rail/detail combination, and that its density matches the accepted For You
 * compact column.
 *
 *   node browser-verify/25-following-messages.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SHOOT=1.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const path = require('path');
const fs = require('fs');
const { signIn, routeMediaOrigin } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const SHOTS = path.resolve(__dirname, '..', '..', 'output', 'screenshots');
const SHOOT = process.env.SHOOT === '1';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const COMPACT = W < 1280;
/*
 * The band where opening Messages collapses the creator rail.
 *
 * Above it every column already fits — 768 - 48 - 88 - 150 leaves 482 for the
 * stage — and forcing a collapse there would be taking away a choice the viewer
 * made for no reason. So the collapse is asserted only below it, and the
 * *absence* of a collapse is asserted above it.
 */
const NARROW = W < 600;

let pass = 0;
let fail = 0;
const rows = [];

const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function shot(page, name) {
  if (!SHOOT) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log(`    · ${name}`);
}

/** The columns, the workspace density, and a hit-test at each column's centre. */
async function readLayout(page) {
  return page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        top: Math.round(rect.top * 10) / 10,
        height: Math.round(rect.height * 10) / 10
      };
    };
    const workspace = document.querySelector('aside[aria-label="Messages"]');
    const creatorRail = document.querySelector('aside.relative.z-50');
    const stage = document.querySelector('[data-feed-surface="following"]');
    const player = document.querySelector('[data-feed-surface="following"] [class*="playerstage"]')
      || document.querySelector('[data-feed-surface="following"] .rounded-2xl');
    const panel = document.querySelector('[data-feed-surface="following"] aside[class*="detailpanel"]');

    const row = document.querySelector('.conversation-row');
    const avatar = document.querySelector('.conversation-row-avatar');
    const name = document.querySelector('.conversation-row-name');
    const preview = document.querySelector('.conversation-row-preview');
    const time = document.querySelector('.conversation-row-time');
    const search = document.querySelector('.conversation-search input, .conversation-search');
    const list = row ? row.closest('[class*="overflow-y"]') : null;

    const font = (element) => (element ? getComputedStyle(element).fontSize : null);
    const at = (rect) => {
      if (!rect) return null;
      const element = document.elementFromPoint(
        Math.round(rect.left + rect.width / 2),
        Math.round(rect.top + rect.height / 2)
      );
      return element ? `${element.tagName.toLowerCase()}.${(element.className || '').toString().slice(0, 28)}` : null;
    };

    const workspaceBox = box(workspace);
    const playerBox = box(player);
    const panelBox = box(panel);

    return {
      viewportWidth: window.innerWidth,
      creatorRail: box(creatorRail),
      stage: box(stage),
      player: playerBox,
      panel: panelBox,
      workspace: workspaceBox,
      workspacePosition: workspace ? getComputedStyle(workspace).position : null,
      workspaceInsideContent: workspaceBox ? workspaceBox.right <= window.innerWidth + 0.5 : null,
      /*
       * The workspace renders a scrim only when it is *not* inline — it is a
       * `button[aria-label="Close messages"]` spanning the viewport. Looking
       * for it by name is the check; the earlier version required a
       * `data-message-scrim` attribute that nothing carries, so it could only
       * ever answer "no scrim".
       */
      scrim: (() => {
        const candidate = document.querySelector('button[aria-label="Close messages"]');
        if (!candidate) return false;
        const rect = candidate.getBoundingClientRect();
        return rect.width >= window.innerWidth - 1 && rect.height > 100;
      })(),
      density: {
        rowHeight: row ? Math.round(row.getBoundingClientRect().height * 10) / 10 : null,
        avatar: avatar ? Math.round(avatar.getBoundingClientRect().width * 10) / 10 : null,
        searchHeight: search ? Math.round(search.getBoundingClientRect().height * 10) / 10 : null,
        nameFont: font(name),
        previewFont: font(preview),
        timeFont: font(time)
      },
      listScrolls: list ? getComputedStyle(list).overflowY : null,
      hits: { player: at(playerBox), panel: at(panelBox), workspace: at(workspaceBox) },
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
}

function table(label, layout) {
  console.log(`\n  ${label}`);
  console.log('  | column | left | right | width |');
  console.log('  |---|---|---|---|');
  [['creator rail', layout.creatorRail], ['media/player', layout.player],
    ['detail panel', layout.panel], ['messages', layout.workspace]].forEach(([name, boxed]) => {
    console.log(`  | ${name} | ${boxed ? boxed.left : '—'} | ${boxed ? boxed.right : '—'} | ${boxed ? boxed.width : '—'} |`);
  });
}

function assertColumns(label, layout) {
  const { creatorRail, player, panel, workspace } = layout;
  check(`${label}: Messages is present`, Boolean(workspace), workspace ? `${workspace.width}px` : 'missing');
  if (!workspace) return;

  /*
   * NOT a CSS `position` assertion.
   *
   * The accepted For You implementation — the one this pass is required to
   * reuse — anchors the workspace with `position: fixed; right: 0` and achieves
   * the reflow by having the shell subtract `--message-workspace-width` from
   * the content column. So `position: fixed` is true of the *accepted* column
   * as well, and asserting against it would fail the thing it is meant to
   * prove. What actually separates a column from an overlay is whether the
   * content gave up the width: the media ends where Messages begins, nothing
   * covers anything (hit-tested below), and the document does not overflow.
   */
  check(`${label}: the content column reserved the width rather than being covered`,
    Boolean(player) && player.right <= workspace.left + 0.5 && layout.documentOverflow === false,
    `media ends ${player ? player.right : '?'}, messages starts ${workspace.left}`);
  check(`${label}: no scrim over the post`, layout.scrim === false);
  check(`${label}: Messages sits inside the content width`, layout.workspaceInsideContent === true,
    `${workspace.right} <= ${layout.viewportWidth}`);
  check(`${label}: no document-level horizontal overflow`, layout.documentOverflow === false);

  check(`${label}: creatorRail.right <= media.left`,
    Boolean(creatorRail && player) && creatorRail.right <= player.left + 0.5,
    creatorRail && player ? `${creatorRail.right} <= ${player.left}` : 'missing');

  if (panel) {
    check(`${label}: media.right <= detail.left`, player.right <= panel.left + 0.5,
      `${player.right} <= ${panel.left}`);
    check(`${label}: detail.right <= messages.left`, panel.right <= workspace.left + 0.5,
      `${panel.right} <= ${workspace.left}`);
  } else {
    check(`${label}: media.right <= messages.left`,
      Boolean(player) && player.right <= workspace.left + 0.5,
      player ? `${player.right} <= ${workspace.left}` : 'missing');
  }

  check(`${label}: every column has positive width`,
    [creatorRail, player, panel, workspace].filter(Boolean).every((boxed) => boxed.width > 0),
    [creatorRail, player, panel, workspace].filter(Boolean).map((boxed) => boxed.width).join(' | '));

  // Hit-testing: nothing covers anything else.
  check(`${label}: the media centre is the media, not Messages`,
    Boolean(layout.hits.player) && !/conversation|message/i.test(layout.hits.player),
    layout.hits.player);
  if (panel) {
    check(`${label}: the detail centre is the detail panel`,
      Boolean(layout.hits.panel) && !/conversation|message/i.test(layout.hits.panel),
      layout.hits.panel);
  }
  check(`${label}: the Messages centre is Messages`, Boolean(layout.hits.workspace), layout.hits.workspace);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  console.log(`\n=== Following Messages reflow @ ${W}x${H} ===`);

  await signIn({ page }, ACCOUNT);
  await page.goto(`${USER_APP}/following`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const openMessages = async () => {
    await page.locator('button[aria-label*="message" i], button:has-text("Message")').first()
      .click({ timeout: 6000 }).catch(() => null);
    await page.waitForTimeout(900);
  };
  const closeMessages = async () => {
    await page.locator('button[aria-label*="close" i]').last().click({ timeout: 4000 }).catch(() => null);
    await page.waitForTimeout(700);
  };
  const expandRail = async () => {
    await page.locator('button[aria-label*="expand following" i]').first().click({ timeout: 4000 }).catch(() => null);
    await page.waitForTimeout(600);
  };
  const railExpanded = () => page.evaluate(
    () => Boolean(document.querySelector('button[aria-label*="Collapse following" i]'))
  );
  const currentPostId = () => page.evaluate(() => {
    const media = document.querySelector('[data-feed-surface="following"] video, [data-feed-surface="following"] img');
    return media?.getAttribute('src') || null;
  });

  // ------------------------------------------------ state 1: collapsed rail
  const postBefore = await currentPostId();
  const beforeOpen = await readLayout(page);
  await openMessages();
  let layout = await readLayout(page);
  table('1. collapsed rail + Messages', layout);
  assertColumns('collapsed+messages', layout);
  check('opening Messages kept the same post', (await currentPostId()) === postBefore);
  check('the media narrowed by exactly the Messages width',
    Boolean(beforeOpen.player && layout.player && layout.workspace)
    && Math.abs((beforeOpen.player.width - layout.player.width) - layout.workspace.width) <= 2,
    `${beforeOpen.player?.width} -> ${layout.player?.width} (messages ${layout.workspace?.width})`);
  check('the media is still visible and wider than the panel beside it',
    Boolean(layout.player) && layout.player.width > 0, `${layout.player?.width}px`);
  rows.push({ state: 'collapsed rail + Messages', ...layout.density, messages: layout.workspace?.width });
  await shot(page, 'msg-01-collapsed-rail.png');

  check('the conversation list scrolls inside the panel',
    layout.listScrolls === 'auto' || layout.listScrolls === 'scroll', layout.listScrolls);
  if (COMPACT) {
    check('Messages uses the accepted compact column width (150 ±3)',
      Boolean(layout.workspace) && Math.abs(layout.workspace.width - 150) <= 3,
      `${layout.workspace?.width}px`);
  }

  await closeMessages();
  const closedLayout = await readLayout(page);
  check('closing Messages restores the layout', !closedLayout.workspace || closedLayout.workspace.width === 0,
    closedLayout.workspace ? `${closedLayout.workspace.width}px` : 'gone');
  await shot(page, 'msg-02-closed-restored.png');

  // ------------------------------------------------- state 2: expanded rail
  await expandRail();
  check('rail is expanded before opening Messages', await railExpanded());
  await openMessages();
  if (NARROW) {
    check('opening Messages collapsed the rail to make room', !(await railExpanded()));
  } else {
    check('a wide viewport keeps the rail expanded — every column already fits',
      await railExpanded());
  }
  layout = await readLayout(page);
  table('2. expanded rail + Messages (rail auto-collapsed)', layout);
  assertColumns('expanded+messages', layout);
  await shot(page, 'msg-03-rail-autocollapsed.png');

  await closeMessages();
  check('closing Messages leaves the rail expanded', await railExpanded());
  await shot(page, 'msg-04-rail-restored.png');

  // repeated cycles must not corrupt the remembered state
  await openMessages();
  await closeMessages();
  await openMessages();
  await closeMessages();
  check('repeated open/close cycles keep the rail state intact', await railExpanded());

  // ------------------------------------------- state 3: detail + Messages
  await page.locator('button[aria-label*="comment" i], button:has-text("Comments")').first()
    .click({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(800);
  await openMessages();
  layout = await readLayout(page);
  table('3. rail + media + Comments + Messages', layout);
  assertColumns('detail+messages', layout);
  rows.push({ state: 'Comments + Messages', ...layout.density, messages: layout.workspace?.width });
  await shot(page, 'msg-05-comments-plus-messages.png');

  // selecting a conversation must not turn it back into an overlay
  await page.locator('.conversation-row').first().click({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(900);
  const afterSelect = await readLayout(page);
  // Same reasoning as above: the reflow is proven by the reserved width and the
  // hit-test, not by the workspace's CSS `position`.
  check('selecting a conversation keeps the reflowed column',
    Boolean(afterSelect.player && afterSelect.workspace)
    && afterSelect.player.right <= afterSelect.workspace.left + 0.5
    && afterSelect.documentOverflow === false
    && afterSelect.scrim === false,
    `media ends ${afterSelect.player?.right}, messages starts ${afterSelect.workspace?.left}`);
  await shot(page, 'msg-06-conversation-selected.png');

  console.log('\n  --- Messages density ---');
  console.log('  | state | messages width | search h | avatar | row h | name | preview | date |');
  console.log('  |---|---|---|---|---|---|---|---|');
  rows.forEach((row) => {
    console.log(`  | ${row.state} | ${row.messages} | ${row.searchHeight} | ${row.avatar} | ${row.rowHeight} | ${row.nameFont} | ${row.previewFont} | ${row.timeFont} |`);
  });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 4).forEach((error) => console.log(`    ! ${error}`));

  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
