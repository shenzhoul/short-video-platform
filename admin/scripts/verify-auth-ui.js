/**
 * Regression checks for the admin auth UI, as a script rather than a spec.
 *
 * `admin/` declares `yarn test` but has no Jest config and no test files
 * (tracked as `bug-admin-test-script-missing-jest-config`), so there is nowhere
 * for a `.spec.tsx` to run. Rather than stand up a test runner as a side effect
 * of an unrelated change, these assertions are made here, in the shape the repo
 * already uses for verification scripts under `api/scripts/`.
 *
 * What it guards: the password-recovery UI removed on 2026-08-26. That page
 * posted to `POST /auth/forgot`, a route the API has never implemented, and
 * rendered the 404 as "Account not found, please recheck the email" — a missing
 * feature that looked like a rejected email address. These checks exist so it
 * cannot come back by accident, and so that removing it did not quietly take the
 * login form with it.
 *
 * Usage:
 *   node scripts/verify-auth-ui.js
 *
 * Exit code 0 = all checks held.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const failures = [];
function check(name, ok, detail = '') {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

/** Every source file, so a reference cannot hide in a directory nobody looked in. */
function sourceFiles(dir = SRC, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, found);
    } else if (/\.(ts|tsx|js|jsx|scss|css)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const files = sourceFiles();
const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

/**
 * Source with comments stripped.
 *
 * Every check below is about what the app *does*, not what it says about itself.
 * The notes explaining why recovery was removed necessarily name the endpoint
 * that was removed, and must not trip the guard against calling it.
 */
const code = (file) => read(file)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The proxy names the retired path on purpose, to redirect it. */
const isExempt = (file) => /proxy\.ts$/.test(file) || /scripts[\\/]/.test(file);

// --- the recovery UI is gone -------------------------------------------------

check('the /auth/forgot route no longer exists',
  !fs.existsSync(path.join(SRC, 'app/auth/forgot')));

check('the forgot-password component no longer exists',
  !fs.existsSync(path.join(SRC, 'components/auth/forgot.tsx')));

// A page can be deleted while the request that made it useless survives in the
// service layer, ready for the next caller.
const callsForgotEndpoint = files.filter(
  (file) => !isExempt(file) && /['"`]\/auth\/forgot['"`]/.test(code(file))
);
check('no client code posts to POST /auth/forgot',
  callsForgotEndpoint.length === 0,
  callsForgotEndpoint.map(rel).join(', '));

const declaresResetPassword = files.filter(
  (file) => /^\s*resetPassword\s*[=(]/m.test(code(file))
);
check('no resetPassword client method remains',
  declaresResetPassword.length === 0,
  declaresResetPassword.map(rel).join(', '));

// --- the login form no longer advertises it ----------------------------------

const loginFormPath = path.join(SRC, 'components/auth/login-form.tsx');
check('the admin login form still exists', fs.existsSync(loginFormPath));

const loginForm = fs.existsSync(loginFormPath) ? read(loginFormPath) : '';
const loginFormCode = fs.existsSync(loginFormPath) ? code(loginFormPath) : '';

check('the login form has no forgot-password link or CTA',
  !/forgot/i.test(loginFormCode),
  (loginFormCode.match(/.*forgot.*/i) || [''])[0].trim());

check('the login form does not render the misleading "Account not found" text',
  !/Account not found/i.test(loginFormCode));

// --- login itself still works ------------------------------------------------

check('the login form still submits credentials through next-auth',
  /signIn\(/.test(loginForm) && /credentials/.test(loginForm));

check('the login form still hashes the password before sending it',
  /hashPassword\(/.test(loginForm));

check('the login page route still exists',
  fs.existsSync(path.join(SRC, 'app/auth/login/page.tsx')));

check('the logout route still exists',
  fs.existsSync(path.join(SRC, 'app/auth/logout')));

// --- old links still land somewhere sensible ---------------------------------

const proxy = read(path.join(SRC, 'proxy.ts'));
check('the proxy redirects /auth/forgot to the login page',
  /pathname === '\/auth\/forgot'/.test(proxy)
  && /redirect\(`\$\{origin\}\/auth\/login`\)/.test(proxy));

// --- nothing new pretends recovery works -------------------------------------

const promisesRecovery = files.filter(
  (file) => !isExempt(file) && /reset (your )?password|forgot password|password reset/i.test(code(file))
);
check('no admin UI copy promises password recovery',
  promisesRecovery.length === 0,
  promisesRecovery.map(rel).join(', '));

if (failures.length) {
  console.log(`\n${failures.length} FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log(`\nall ${files.length} source files checked; every assertion held`);
