/**
 * Compose before/after screenshots into a single labelled side-by-side image.
 *
 * A reviewer comparing two files in a folder has to remember what changed
 * between them; one image with both halves labelled does not ask that.
 *
 *   node browser-verify/lib/make-comparison.js <out.png> "<label>=<file>" ...
 *
 * Env: PLAYWRIGHT_PATH.
 */
const path = require('path');
const fs = require('fs');

const { chromium } = require(process.env.PLAYWRIGHT_PATH);

const SHOTS = path.resolve(__dirname, '..', '..', '..', 'output', 'screenshots');

(async () => {
  const [outName, ...pairs] = process.argv.slice(2);
  if (!outName || pairs.length < 2) {
    console.error('usage: make-comparison.js <out.png> "<label>=<file>" "<label>=<file>" [...]');
    process.exit(1);
  }

  const panes = pairs.map((pair) => {
    const index = pair.indexOf('=');
    const label = pair.slice(0, index);
    const file = path.join(SHOTS, pair.slice(index + 1));
    if (!fs.existsSync(file)) throw new Error(`missing screenshot: ${file}`);
    return { label, dataUri: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` };
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #14141a; font: 600 15px/1.4 -apple-system, Segoe UI, sans-serif; color: #f2f2f5; }
    .row { display: flex; gap: 16px; padding: 16px; align-items: flex-start; }
    figure { margin: 0; display: flex; flex-direction: column; gap: 8px; }
    figcaption { padding: 6px 10px; border-radius: 8px; background: #26262f; }
    img { display: block; width: 440px; border-radius: 10px; border: 1px solid #34343f; }
  </style></head><body><div class="row">
    ${panes.map((pane) => `<figure><figcaption>${pane.label}</figcaption><img src="${pane.dataUri}"></figure>`).join('')}
  </div></body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: panes.length * 472 + 16, height: 1000 } });
  await page.setContent(html, { waitUntil: 'load' });
  const out = path.join(SHOTS, outName);
  await page.locator('.row').screenshot({ path: out });
  await browser.close();
  console.log(`wrote ${out}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
