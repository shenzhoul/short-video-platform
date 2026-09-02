#!/usr/bin/env node
/**
 * Phase 1 — `yarn demo:fetch-media`
 *
 * Fetches every piece of media the demo dataset needs from Pexels (primary) and
 * Pixabay (fallback), validates it against the project's own upload policies,
 * draws the account avatars locally, and writes a manifest recording where each
 * file came from.
 *
 * Touches the network and the media cache. Touches no database. Safe to run
 * repeatedly: cached files are not re-downloaded, and the manifest is the record
 * of what is already present.
 *
 * Nothing here writes an API key to a log, a URL it prints, an error, or the
 * manifest. See `lib/logger.js` for why that is enforced in the sink rather
 * than at each call site.
 */

const fs = require('fs');
const path = require('path');

const config = require('./demo.config');
const logger = require('./lib/logger');
const env = require('./lib/env');
const manifestLib = require('./lib/manifest');
const { createFetcher, toPosix } = require('./lib/fetcher');
const { resolveAccountPlan } = require('./lib/account-plan');
const { createPexelsProvider } = require('./lib/providers/pexels');
const { createPixabayProvider } = require('./lib/providers/pixabay');
const { assertFfmpegAvailable } = require('./lib/ffmpeg');
const { renderAvatar } = require('./lib/avatar');
const { validateImage } = require('./lib/validate');

/**
 * Draw the account avatars.
 *
 * Locally generated rather than fetched, because a stock photograph of a real
 * person presented as the owner of a fictional account is an impersonation the
 * licence does not cover. See `lib/avatar.js`.
 *
 * Written only when absent or when the bytes have changed, so a re-run is a
 * no-op rather than a rewrite — the generator is deterministic, so identical
 * input produces identical bytes and the checksum in the manifest stays valid.
 */
async function generateAvatars(manifest, mediaDir, themes) {
  let created = 0;
  let cached = 0;

  for (const theme of themes) {
    const accounts = theme.accounts;
    for (let i = 0; i < accounts.length; i += 1) {
      const account = accounts[i];
      const relativePath = toPosix(path.join(theme.key, 'avatar', `${account.username}.png`));
      const absolutePath = path.join(mediaDir, relativePath);

      const existing = manifest.entries.find(
        (e) => e.purpose === 'avatar' && e.sourceMediaId === account.username
      );
      if (existing && fs.existsSync(absolutePath)) {
        cached += 1;
        continue;
      }

      const png = renderAvatar({
        username: account.username,
        themeKey: theme.key,
        indexInTheme: i,
        size: config.media.avatar.size,
        accountsInTheme: accounts.length
      });

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, png);

      // Held to the same policy as anything downloaded. A generated file is not
      // exempt from the limits the upload pipeline will apply to it.
      const measured = await validateImage(absolutePath, 'avatar', {});
      if (!measured.ok) {
        throw new Error(`generated avatar for ${account.username} failed validation: ${measured.reason}`);
      }

      const checksum = await manifestLib.checksumFile(absolutePath);
      // Replace rather than append, so regenerating never leaves two entries
      // claiming the same slot.
      const at = manifest.entries.findIndex(
        (e) => e.purpose === 'avatar' && e.sourceMediaId === account.username
      );
      const entry = manifestLib.buildGeneratedEntry({
        theme: theme.key,
        purpose: 'avatar',
        localFile: relativePath,
        checksum,
        measured,
        generator: 'demo/lib/avatar.js',
        seed: account.username
      });
      if (at >= 0) manifest.entries[at] = entry; else manifest.entries.push(entry);
      created += 1;
    }
  }

  return { created, cached };
}

/**
 * Optional `--themes=a,b` filter.
 *
 * Re-fetching one theme after editing its queries is a real workflow, and doing
 * it by commenting entries out of `themes.js` risks committing the edit. The
 * filter narrows what this run fetches; it never narrows what `demo:seed`
 * requires, so a partial fetch still leaves the other themes reported as short.
 */
function selectedThemes() {
  const argument = process.argv.slice(2).find((a) => a.startsWith('--themes='));
  if (!argument) return config.themes;

  const wanted = argument.slice('--themes='.length).split(',').map((s) => s.trim()).filter(Boolean);
  const known = new Set(config.themes.map((t) => t.key));
  const unknown = wanted.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new Error(`unknown theme: ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
  }
  return config.themes.filter((t) => wanted.includes(t.key));
}

async function main() {
  logger.step('Demo media fetch');

  // Credentials first: there is no point walking the theme list if the run
  // cannot make a request. Both values are registered as unprintable here.
  const { pexelsKey, pixabayKey } = env.loadFetchCredentials();
  logger.detail(`PEXELS_API_KEY  present (${pexelsKey.length} chars) — value never printed`);
  logger.detail(pixabayKey
    ? `PIXABAY_API_KEY present (${pixabayKey.length} chars) — fallback enabled`
    : 'PIXABAY_API_KEY not set — Pexels only, slots it cannot fill stay short');

  await assertFfmpegAvailable();
  logger.detail('ffmpeg and ffprobe available');

  const mediaDir = config.MEDIA_DIR;
  fs.mkdirSync(mediaDir, { recursive: true });
  const manifest = manifestLib.load(config.MANIFEST_PATH);
  logger.detail(`manifest: ${manifest.entries.length} existing entries`);

  const providers = {
    primary: createPexelsProvider({ apiKey: pexelsKey, network: config.network }),
    fallback: pixabayKey
      ? createPixabayProvider({ apiKey: pixabayKey, network: config.network })
      : null
  };

  const fetcher = createFetcher({
    config, manifest, manifestPath: config.MANIFEST_PATH, mediaDir, providers
  });

  // How much media each theme needs comes from the account plan, which derives
  // it from the configured post mix. Nothing here knows a count of its own.
  const accountPlan = resolveAccountPlan(config, config.themes);
  if (!accountPlan.ok) {
    logger.error('the theme/account configuration is not usable:');
    for (const problem of accountPlan.problems) logger.detail(`- ${problem}`);
    process.exitCode = 1;
    return;
  }
  const requirementsByTheme = new Map(
    accountPlan.plan.themes.map((entry) => [entry.theme.key, entry.requirements])
  );

  const themes = selectedThemes();
  logger.step(`Fetching for ${themes.length} of ${config.themes.length} themes`);
  logger.detail(`${accountPlan.plan.totalAccounts} accounts, ${accountPlan.plan.postsPerAccount} posts each `
    + `(${config.counts.landscapeVideosPerAccount} landscape video, `
    + `${config.counts.portraitVideosPerAccount} portrait video, `
    + `${config.counts.photoPostsPerAccount} photo) = ${accountPlan.plan.totalPosts} posts`);

  const shortfalls = [];
  for (const theme of themes) {
    const required = requirementsByTheme.get(theme.key);
    const accountCount = accountPlan.plan.themes.find((e) => e.theme.key === theme.key).personas.length;
    logger.step(`${theme.label} (${theme.key}) — ${accountCount} account(s), category '${theme.topicKey}'`);
    for (const purpose of ['post-video-landscape', 'post-video-portrait', 'post-photo', 'cover']) {
      const result = await fetcher.fillSlot(theme, purpose, required[purpose]);
      const line = `${purpose}: ${result.have}/${result.required} (target ${result.target})`;
      if (!result.satisfied) {
        logger.error(`${line} — SHORT`);
        shortfalls.push({ theme: theme.key, purpose, ...result });
      } else if (result.cachedOnly) {
        logger.skip(`${line} — already cached`);
      } else {
        logger.ok(line);
      }
    }
  }

  logger.step('Generating avatars');
  const avatars = await generateAvatars(manifest, mediaDir, themes);
  manifestLib.save(config.MANIFEST_PATH, manifest);
  logger.ok(`${avatars.created} drawn, ${avatars.cached} already present`);

  logger.step('Summary');
  const index = manifestLib.index(manifest, mediaDir);
  logger.detail(`manifest entries on disk: ${index.live.length}`);
  logger.detail(`downloaded this run: ${fetcher.stats.downloaded} (${(fetcher.stats.bytes / 1048576).toFixed(1)} MB)`);
  logger.detail(`duplicates skipped: ${fetcher.stats.duplicates}, rejected by validation: ${fetcher.stats.rejected}`);
  logger.detail(`manifest: ${config.MANIFEST_PATH}`);
  if (providers.primary.remainingQuota !== null) {
    logger.detail(`pexels quota remaining: ${providers.primary.remainingQuota}`);
  }

  if (shortfalls.length > 0) {
    logger.error(`${shortfalls.length} slot(s) short of the minimum. \`yarn demo:seed\` will refuse to run.`);
    logger.detail('Re-run to try more pages, widen the queries in demo/themes.js, or lower the counts in demo/demo.config.js.');
    process.exitCode = 1;
    return;
  }

  logger.info('\nAll slots satisfied. Next: yarn demo:seed');
}

main().catch((error) => {
  // Redacted by the logger, whatever the error carried.
  logger.error(error);
  process.exit(1);
});
