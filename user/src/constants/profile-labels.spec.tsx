/**
 * The watch-later label, and the class of bug it belonged to.
 *
 * The account menu rendered `We&apos;ll look at it later` — the literal
 * characters `&apos;`, on screen, to the viewer — while the profile tab one
 * click away rendered `We'll look at it later` correctly. The difference is
 * where the entity sat: JSX *text* is parsed as markup and `&apos;` becomes an
 * apostrophe, but a **JavaScript string literal** is handed to React verbatim
 * and React escapes it, so the ampersand survives to the DOM.
 *
 * Three things are pinned here:
 *
 * 1. the canonical labels contain a real apostrophe and no entity;
 * 2. both surfaces render that label, from the same source;
 * 3. no string literal anywhere in either web app carries an HTML entity —
 *    which is the check that catches the *next* one, in a file nobody thought
 *    to look at. It is a source scan for the same reason
 *    `toast-import-rule.spec.ts` runs ESLint for real: a hand-written list of
 *    known-good files would keep passing while a new file went wrong.
 */

import fs from 'fs';
import path from 'path';

import { PROFILE_COLLECTION_LABELS } from './profile-labels';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_ROOTS = [
  path.join(REPO_ROOT, 'user', 'src'),
  path.join(REPO_ROOT, 'admin', 'src')
];

/** Any HTML character-entity reference: named, decimal or hexadecimal. */
const HTML_ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
      return;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  });
  return out;
}

/**
 * Single- and double-quoted JavaScript string literals on one line.
 *
 * Deliberately not a parser. It over-matches inside comments, which is why the
 * scan skips comment lines, and it does not see template literals — those are
 * covered separately below. What it must not do is miss the shape that shipped:
 * a quoted literal holding an entity, used as a JSX expression value.
 */
const QUOTED_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

describe('profile collection labels', () => {
  it('spell the apostrophe as a real character, never as an entity', () => {
    Object.entries(PROFILE_COLLECTION_LABELS).forEach(([key, label]) => {
      expect(`${key}: ${label}`).not.toMatch(HTML_ENTITY);
    });
    expect(PROFILE_COLLECTION_LABELS.watchLater).toBe("We'll look at it later");
    expect(PROFILE_COLLECTION_LABELS.watchLater).toContain(String.fromCharCode(39));
  });

  it('are the strings both the profile tab strip and the account menu use', () => {
    const dropdown = fs.readFileSync(
      path.join(REPO_ROOT, 'user', 'src', 'components', 'layout', 'navigation', 'user-account-dropdown.tsx'),
      'utf8'
    );
    const profile = fs.readFileSync(
      path.join(REPO_ROOT, 'user', 'src', 'components', 'creator', 'creator-profile-page.tsx'),
      'utf8'
    );

    // Neither surface may retype a label; both read this module.
    [dropdown, profile].forEach((source) => {
      expect(source).toContain('PROFILE_COLLECTION_LABELS');
      expect(source).not.toContain('look at it later\'');
      expect(source).not.toContain('look at it later"');
    });
    expect(dropdown).toContain('PROFILE_COLLECTION_LABELS.watchLater');
    expect(profile).toContain('PROFILE_COLLECTION_LABELS.watchLater');
  });

  it('no string literal in user/ or admin/ carries an HTML entity', () => {
    const offenders: string[] = [];

    SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root)).forEach((file) => {
      // This spec documents the broken form in its own prose.
      if (file.endsWith(path.join('constants', 'profile-labels.ts'))) return;
      if (file.endsWith(path.join('constants', 'profile-labels.spec.tsx'))) return;

      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const trimmed = line.trim();
        // Comment lines describe the bug rather than shipping it.
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

        let match = QUOTED_LITERAL.exec(line);
        while (match) {
          const literal = match[1] ?? match[2] ?? match[3] ?? '';
          if (HTML_ENTITY.test(literal)) {
            offenders.push(`${path.relative(REPO_ROOT, file)}:${index + 1} → ${literal.slice(0, 60)}`);
          }
          match = QUOTED_LITERAL.exec(line);
        }
        QUOTED_LITERAL.lastIndex = 0;
      });
    });

    expect(offenders).toEqual([]);
  });
});
