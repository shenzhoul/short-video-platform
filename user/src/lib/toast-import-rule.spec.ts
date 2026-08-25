import { ESLint } from 'eslint';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The lint rule that keeps dead toasts from coming back.
 *
 * `SharedToastProvider` registers its container with a `containerId`, and
 * `react-toastify` only delivers a toast to a container whose id matches. A call
 * made straight from the library is therefore dispatched to a container that
 * does not exist and renders nothing — silently, with no error and no warning.
 * That is how 34 files ended up with success and error messages that never
 * reached anyone.
 *
 * A rule nobody has watched fail is a rule nobody knows works, so this runs
 * ESLint for real against source that breaks it and asserts the failure, rather
 * than reading the config back and trusting it.
 */
describe('the ban on importing react-toastify directly', () => {
  const root = path.resolve(__dirname, '../..');

  beforeAll(() => {
    // ESLint's config schema clones rule options with `structuredClone`, which
    // jsdom does not provide. The suite runs under jsdom because the shared
    // `jest.setup.ts` expects a `window`, so the gap is filled here rather than
    // by moving this one file to the node environment.
    if (typeof (globalThis as any).structuredClone !== 'function') {
      (globalThis as any).structuredClone = (value: unknown) => JSON.parse(JSON.stringify(value));
    }
  });

  /**
   * ESLint's verdict on a snippet, through its Node API.
   *
   * Linted as text at a path inside `src/`, so the project's real flat config
   * applies without leaving a temporary file behind for a crashed run to strand.
   */
  const lintSource = async (source: string, filePath = 'src/__toast-rule-probe.ts') => {
    // The project's real flat config, loaded rather than reimplemented — this
    // has to fail for the same reason `yarn lint` does or it proves nothing.
    //
    // Passed in directly because ESLint 9 loads a config file through a dynamic
    // `import()`, which Jest's CommonJS transform intercepts. `eslint.config.js`
    // is CommonJS, so requiring it gives the identical array.

    const projectConfig = require(path.join(root, 'eslint.config.js'));
    const configured = projectConfig
      .find((entry: any) => entry?.rules?.['no-restricted-imports'])
      ?.rules['no-restricted-imports'];
    expect(configured).toBeDefined();

    // The rule as the project configures it, applied on its own. Running the
    // whole array here is not possible — its trailing `ignores`-only entry is
    // not a valid `baseConfig` — and is not the point: what must be proven is
    // that this rule, with these options, rejects the import.
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      baseConfig: [{
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: require('@typescript-eslint/parser') },
        rules: { 'no-restricted-imports': configured }
      }]
    });
    const [result] = await eslint.lintText(source, { filePath: path.join(root, filePath) });
    return result.messages;
  };

  const restricted = (messages: any[]) => messages
    .filter((m) => m.ruleId === 'no-restricted-imports');

  it('fails a value import of the library', async () => {
    const hits = restricted(await lintSource(
      'import { toast } from \'react-toastify\';\nexport const boom = () => toast.error(\'nope\');\n'
    ));

    expect(hits.length).toBeGreaterThan(0);
    // An error, not a warning: a warning would let this ship again.
    expect(hits[0].severity).toBe(2);
    expect(hits[0].message).toContain('@douyin-clone/shared-toast');
  }, 120000);

  it('fails a subpath import such as the stylesheet', async () => {
    // The shared package owns the stylesheet now, so an app reaching for it
    // directly is a sign the provider was bypassed.
    const hits = restricted(await lintSource('import \'react-toastify/dist/ReactToastify.css\';\n'));

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].severity).toBe(2);
  }, 120000);

  it('allows the shared package', async () => {
    const hits = restricted(await lintSource(
      'import { toast } from \'@douyin-clone/shared-toast\';\nexport const fine = () => toast.error(\'yes\');\n'
    ));

    expect(hits).toHaveLength(0);
  }, 120000);

  it('leaves no direct import anywhere in the app', () => {
    // The rule stops new ones; this proves none survived the migration. Walks
    // the tree rather than shelling out, so it behaves the same on every
    // platform and in CI.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          return;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.spec\.(ts|tsx)$/.test(entry.name)) return;
        const source = fs.readFileSync(full, 'utf8');
        if (/from\s+['"]react-toastify['"]|import\s+['"]react-toastify/.test(source)) {
          offenders.push(path.relative(root, full));
        }
      });
    };
    walk(path.join(root, 'src'));

    expect(offenders).toEqual([]);
  });
});
