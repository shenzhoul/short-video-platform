/**
 * The one predicate that decides whether an account's email counts as
 * confirmed.
 *
 * A single function rather than an inline comparison in each caller, because the
 * comparison has a direction that is easy to get wrong and expensive to get
 * wrong in only one place.
 */

type EmailVerifiable = { verifiedEmail?: boolean };

/**
 * True when the account has **not** confirmed its address.
 *
 * `!== true`, never `=== false`. The schema defaults the field to `false`, but a
 * document written outside Mongoose — a migration, a repair script, a manual
 * fix — can omit it entirely, and `undefined === false` is `false`, which would
 * quietly treat an unconfirmed account as confirmed. The safe direction is that
 * anything which is not literally `true` has to verify.
 *
 * There is deliberately no setting or feature flag behind this. Verification is
 * either how the product works or it is not; a runtime switch would mean the
 * login path behaves differently depending on a database row, which is a
 * property nobody wants to debug.
 */
export function requiresEmailVerification(user: EmailVerifiable | null | undefined): boolean {
  return user?.verifiedEmail !== true;
}
